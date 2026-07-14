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

self.onmessage = (e) => {
  const { type, nodes, links, width, height } = e.data;

  if (type === "stop") {
    sim?.stop();
    sim = null;
    return;
  }

  if (type !== "layout") return;

  sim?.stop();

  // d3-force MUTATES these objects, adding x/y/vx/vy. They are plain clones of the node
  // ids, never the React node objects — mutating those would be a fine way to produce a
  // very confusing bug.
  const simNodes = nodes.map((id) => ({ id }));
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
    .stop();

  const total = Math.ceil(Math.log(sim.alphaMin()) / Math.log(1 - sim.alphaDecay()));
  const positions = new Float32Array(n * 2);

  for (let i = 0; i < total; i += 1) {
    sim.tick();
    // Stream a frame every few ticks. Copying into a transferable Float32Array (rather
    // than posting the node objects) keeps the hand-off to a memcpy.
    if (i % 3 === 0 || i === total - 1) {
      for (let k = 0; k < n; k += 1) {
        positions[k * 2] = simNodes[k].x;
        positions[k * 2 + 1] = simNodes[k].y;
      }
      const copy = positions.slice();
      self.postMessage(
        { type: "tick", positions: copy, progress: (i + 1) / total, done: i === total - 1 },
        [copy.buffer]
      );
    }
  }
};
