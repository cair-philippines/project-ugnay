// Force-directed layout, off the main thread.
//
// It runs in a worker because the layout is the one genuinely expensive thing this view
// does — a whole region is ~6,700 nodes — and a settling simulation on the main thread
// would compete with the very repaints it exists to feed. The worker streams positions
// back as it converges, so the graph visibly SETTLES rather than appearing fully formed:
// watching clusters pull together and stranded nodes drift out is most of how a user
// builds the intuition this view is for.
//
// Why plain forces are the right layout here. The thing we want to be legible — an
// institution whose pathway goes nowhere — is a STRUCTURAL property: it has few or no
// edges. Charge repulsion pushes unconnected nodes apart while links hold clusters
// together, so the broken ones fall to the periphery on their own. We are not imposing
// the answer; the layout is letting the graph state it.
//
// TWO THINGS THIS FILE HAS TO GET RIGHT, both learned the hard way:
//
//  1. IT MUST YIELD. The first version ran every tick in one synchronous `for` loop and
//     posted a frame every third tick. The simulation therefore finished as fast as the CPU
//     could grind it out, and ~115 messages landed on the main thread in a burst. Nothing
//     was paced to a frame, so the "animation" was whatever the browser managed to paint
//     between floods — which is exactly the stutter it was supposed to avoid. Now it ticks
//     for a frame's worth of time, posts once, and hands the thread back.
//
//  2. IT MUST BE SEEDABLE. Starting positions are an argument, not a detail. Seeded from
//     the map's screen coordinates, the graph BEGINS as the map and unfolds out of it —
//     which is both the transition and a much better initial condition than d3's default
//     phyllotaxis spiral, so it settles in fewer ticks. Seeded from the previous layout, a
//     threshold change nudges the existing graph instead of detonating it.

import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  forceX,
  forceY,
} from "d3-force";

let sim = null;
let run = 0; // bumped on every new layout, so a stale scheduled frame can bail out

// A frame's budget. We tick until it is spent (or we hit the cap), then post and yield —
// so one message is one painted frame, however many ticks that took. On a big region a
// tick is several ms, so this self-adjusts: the animation stays smooth and simply takes
// longer to finish, rather than staying "fast" by dropping every frame in between.
const FRAME_BUDGET_MS = 11;
const MAX_TICKS_PER_FRAME = 6;

self.onmessage = (e) => {
  const { type, nodes, links, width, height, seed, alpha } = e.data;

  if (type === "stop") {
    run += 1;
    sim?.stop();
    sim = null;
    return;
  }

  if (type !== "layout") return;

  run += 1;
  const myRun = run;
  sim?.stop();

  // d3-force MUTATES these objects, adding x/y/vx/vy. They are plain clones of the node
  // ids, never the React node objects — mutating those would be a fine way to produce a
  // very confusing bug.
  const simNodes = nodes.map((id, i) => {
    const n = { id };
    // A seed is only a seed: the forces are free to move it anywhere. Non-finite values
    // (a node the map could not project) are left for d3 to place.
    if (seed && Number.isFinite(seed[i * 2]) && Number.isFinite(seed[i * 2 + 1])) {
      n.x = seed[i * 2];
      n.y = seed[i * 2 + 1];
    }
    return n;
  });
  const index = new Map(simNodes.map((n, i) => [n.id, i]));
  const simLinks = links
    .filter((l) => index.has(l.source) && index.has(l.target))
    .map((l) => ({ source: index.get(l.source), target: index.get(l.target) }));

  const n = simNodes.length;
  // Charge has to soften as the graph grows or a big region blows itself apart, and
  // distanceMax keeps the repulsion local — without it every node pushes on every other,
  // which both costs more and flattens the cluster structure we are trying to show.
  const charge = -30 * Math.max(0.35, Math.min(1, 900 / Math.max(n, 1)));

  sim = forceSimulation(simNodes)
    .force("link", forceLink(simLinks).distance(24).strength(0.9))
    .force("charge", forceManyBody().strength(charge).distanceMax(220).theta(0.9))
    .force("collide", forceCollide(5))
    .force("center", forceCenter(width / 2, height / 2))
    // A weak pull to the middle. forceCenter alone only re-centres the mean position, so
    // isolates — of which there are thousands at a 1 km threshold — would drift off to
    // infinity instead of settling into a readable halo around the connected core.
    .force("x", forceX(width / 2).strength(0.015))
    .force("y", forceY(height / 2).strength(0.015))
    .alphaDecay(0.02)
    .alpha(alpha ?? 1)
    .stop();

  // How many ticks are left from the alpha we were handed. A warm restart (a threshold
  // nudge) starts low and finishes quickly; a cold one runs the full ~340.
  const total = Math.max(
    1,
    Math.ceil(Math.log(sim.alphaMin() / sim.alpha()) / Math.log(1 - sim.alphaDecay()))
  );
  const positions = new Float32Array(n * 2);
  let done = 0;

  const frame = () => {
    if (myRun !== run || !sim) return; // superseded, or stopped

    const t0 = performance.now();
    let ticks = 0;
    do {
      sim.tick();
      done += 1;
      ticks += 1;
    } while (
      done < total &&
      ticks < MAX_TICKS_PER_FRAME &&
      performance.now() - t0 < FRAME_BUDGET_MS
    );

    for (let k = 0; k < n; k += 1) {
      positions[k * 2] = simNodes[k].x;
      positions[k * 2 + 1] = simNodes[k].y;
    }
    // Copying into a transferable Float32Array (rather than posting the node objects)
    // keeps the hand-off to a memcpy.
    const copy = positions.slice();
    const finished = done >= total;
    self.postMessage(
      { type: "tick", positions: copy, progress: done / total, done: finished },
      [copy.buffer]
    );

    if (finished) {
      sim.stop();
      sim = null;
      return;
    }
    // setTimeout(0), not a tight loop: this is what gives the main thread the gap it needs
    // to actually paint the frame we just sent it. (requestAnimationFrame does not exist in
    // a dedicated worker, so the frame budget above is what paces us.)
    setTimeout(frame, 0);
  };

  frame();
};
