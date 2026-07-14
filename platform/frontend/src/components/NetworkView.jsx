import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import ForceWorker from "../workers/forceLayout.worker.js?worker";
import { fillKey, SECTOR_LABEL } from "../lib/graph";
import {
  progressionEdges,
  chainStatus,
  statusCounts,
  tilesArePreS7,
  PATHWAYS,
  STATUS_STYLE,
  STATUS_ORDER,
  VERDICTS,
  NEUTRAL_FILL,
} from "../lib/progression";

// The PROGRESSION NETWORK — the same institutions, laid out by how they CONNECT rather
// than by where they sit.
//
// Geography is dropped on purpose. On a map, a school with no onward pathway looks exactly
// like a school with a perfect one: a dot in a field of dots. Position is spent on
// coordinates, so it cannot be spent on structure. Here, position IS the structure — a
// stranded institution has nothing pulling it inward, so it drifts to the edge and the eye
// finds it without being told where to look.
//
// THE GRAMMAR (rewritten — the first version got this wrong):
//   fill  = the SECTOR, and only once you ask for it. Same colours as the map, so the two
//           views agree instead of quietly contradicting each other.
//   light = the VERDICT, and only once you ask for it. Toggling "Cut" lifts the cut nodes
//           out of a dimmed field; the rest stay as context, because the fact that they sit
//           at the RIM of the structure is the whole argument.
//   Nothing is on by default. The canvas opens deliberately bland — the filters are the
//   question, and an unasked question should not be answered.
//
// Rendered on a CANVAS, not SVG: a region is ~6,700 nodes and ~25,000 edges, and that many
// DOM elements would make hover alone a slideshow. Layout runs in a worker (see
// workers/forceLayout.worker.js).

const EDGE = "rgba(100,116,139,0.28)";
// Muted, not erased. When a verdict is lit the field has to RECEDE, but it must still be
// legible — the whole claim is that the cut nodes sit at the RIM of the structure, and you
// cannot see a rim with nothing behind it. A first pass at 0.09/0.14 dimmed the context into
// invisibility, which turned the strongest thing this view says into a scatter of red dots
// floating in white.
const EDGE_MUTED = "rgba(100,116,139,0.16)";
const EDGE_RESKILL = "rgba(168,85,247,0.35)";

const DIM_ALPHA = 0.28; // a dimmed node: pushed back, never deleted

const INTRO_MS = 550; // the graph fading up over the map it grew out of
const MORPH_MS = 430; // …and folding back down onto it

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

function drawShape(ctx, shape, x, y, r) {
  ctx.beginPath();
  if (shape === "square") {
    ctx.rect(x - r, y - r, r * 2, r * 2);
  } else if (shape === "triangle") {
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y + r);
    ctx.lineTo(x - r, y + r);
    ctx.closePath();
  } else if (shape === "diamond") {
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
  } else {
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
}

export default function NetworkView({
  nodes,
  accessIndex,
  nearestIndex,
  thresholdKm,
  pathway,
  onPathway,
  sectorColors,
  nodeShapes,
  showReskilling,
  netFills,
  netVerdicts,
  onToggleVerdict,
  selectedNode,
  onNodeClick,
  isMobile,
  // The map is still mounted underneath. `projectNode` is its live projection, which is what
  // lets the graph start life as an exact copy of the map and unfold out of it.
  projectNode,
  exiting = false,
}) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const barRef = useRef(null);
  const workerRef = useRef(null);
  const posRef = useRef(null); // Float32Array [x0,y0,x1,y1,…], parallel to `nodes`
  const viewRef = useRef({ k: 1, tx: 0, ty: 0 });
  const rafRef = useRef(0);
  const introRef = useRef(0); // ms timestamp the intro fade started
  const morphRef = useRef(null);
  const userMovedRef = useRef(false);
  const framesRef = useRef(0);

  const [hover, setHover] = useState(null); // { node, sx, sy }
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [settling, setSettling] = useState(false);
  const [bgOn, setBgOn] = useState(false);

  // Edges are DERIVED, not fetched: a level you need next is a level you lack, so every
  // progression edge is already in the accessibility adjacency the tiles ship.
  const edges = useMemo(
    () => progressionEdges(nodes, accessIndex, thresholdKm, pathway),
    [nodes, accessIndex, thresholdKm, pathway]
  );

  const statuses = useMemo(
    () => nodes.map((n) => chainStatus(n, pathway, thresholdKm, nearestIndex)),
    [nodes, pathway, thresholdKm, nearestIndex]
  );
  const counts = useMemo(
    () => statusCounts(nodes, pathway, thresholdKm, nearestIndex),
    [nodes, pathway, thresholdKm, nearestIndex]
  );
  // Tiles older than S7 carry no verdict at all. Say so — loudly, in the view — instead of
  // rendering a graph that looks finished and means nothing.
  const stale = useMemo(() => tilesArePreS7(nodes), [nodes]);

  const indexOf = useMemo(() => new Map(nodes.map((n, i) => [n.node_id, i])), [nodes]);

  // EVERYTHING THE DRAW LOOP READS lives here, not in the loop's dependency array.
  //
  // This is not a micro-optimisation, it is the fix for the stutter that made the settle
  // unwatchable. The loop's effect used to list `progress` and `hover` among its deps, so a
  // worker tick (60/s) or a mouse move tore the effect down, re-created the rAF loop, and
  // re-assigned `canvas.width` — which REALLOCATES the canvas backing store. We were
  // rebuilding the canvas sixty times a second underneath the very animation we wanted
  // people to watch. The loop now depends on the canvas size and nothing else.
  const sceneRef = useRef({});
  sceneRef.current = {
    nodes,
    edges,
    statuses,
    indexOf,
    nodeShapes,
    sectorColors,
    showReskilling,
    netFills,
    netVerdicts,
    selectedNode,
    hover,
    stale,
  };

  // --- canvas sizing (devicePixelRatio-aware; a blurry graph reads as a broken one) ---
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: Math.round(width), h: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // --- seed: where the graph BEGINS ---
  //
  // On first entry that is the map itself — each node's current screen position — so frame
  // zero of the network is pixel-for-pixel the map the user was just looking at, and the
  // forces visibly pull it apart. It is also a far better initial condition than d3's
  // default spiral (real clusters already start near each other), so it settles sooner.
  // On a re-layout (the threshold moved) the seed is the CURRENT layout, so the graph is
  // nudged rather than detonated.
  const seedFor = useCallback(
    (list) => {
      const prev = posRef.current;
      const out = new Float32Array(list.length * 2);
      const warm = prev && prev.length === out.length;
      for (let i = 0; i < list.length; i += 1) {
        if (warm) {
          out[i * 2] = prev[i * 2];
          out[i * 2 + 1] = prev[i * 2 + 1];
          continue;
        }
        const p = projectNode?.(list[i]);
        out[i * 2] = p ? p.x : NaN;
        out[i * 2 + 1] = p ? p.y : NaN;
      }
      return out;
    },
    [projectNode]
  );

  // --- layout ---
  useEffect(() => {
    if (!size.w || !size.h || !nodes.length) return;

    const cold = !posRef.current || posRef.current.length !== nodes.length * 2;
    const seed = seedFor(nodes);
    // Draw the seed immediately: the first painted frame of the network IS the map.
    posRef.current = seed.slice();
    if (cold) introRef.current = performance.now();

    const worker = new ForceWorker();
    workerRef.current = worker;
    setSettling(true);

    worker.onmessage = (e) => {
      const { type, positions, progress: p, done } = e.data;
      if (type !== "tick") return;
      posRef.current = positions;
      if (barRef.current) barRef.current.style.width = `${Math.round(p * 100)}%`;
      if (done) setSettling(false);
    };

    worker.postMessage({
      type: "layout",
      nodes: nodes.map((n) => n.node_id),
      // Reskilling edges are excluded from the FORCES, not just from the chain walk. They
      // are not pathway track, so letting them pull an HEI toward a training centre would
      // fuse two clusters that a learner cannot actually travel between — inventing
      // connectivity in the one view whose entire job is to show its absence.
      links: edges.filter((l) => !l.reskilling),
      width: size.w,
      height: size.h,
      // Cloned, NOT transferred: `posRef` is already holding a copy that the draw loop is
      // painting this very frame, and transferring would detach the buffer out from under it.
      seed,
      // A warm restart gets a gentle alpha: the graph adjusts to the new threshold instead
      // of exploding and re-forming, which would throw away the user's mental map of it.
      alpha: cold ? 1 : 0.35,
    });

    return () => {
      worker.postMessage({ type: "stop" });
      worker.terminate();
      workerRef.current = null;
    };
    // `seedFor` is intentionally omitted: it closes over `projectNode`, which changes
    // identity when the map re-renders, and re-seeding on a map repaint would restart the
    // simulation for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, size.w, size.h]);

  // The background fades UP over the map rather than replacing it instantly, so the map is
  // visible beneath the graph for the first half-second of the unfold.
  useEffect(() => {
    const id = requestAnimationFrame(() => setBgOn(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // --- leaving: fold the graph back down onto the map ---
  //
  // The exit re-projects from the LIVE map rather than reusing the entry seed, so it lands
  // correctly even if the window was resized while the network was open.
  useEffect(() => {
    if (!exiting || !posRef.current || !nodes.length) return;
    const to = new Float32Array(nodes.length * 2);
    let ok = false;
    for (let i = 0; i < nodes.length; i += 1) {
      const p = projectNode?.(nodes[i]);
      if (p) ok = true;
      to[i * 2] = p ? p.x : posRef.current[i * 2];
      to[i * 2 + 1] = p ? p.y : posRef.current[i * 2 + 1];
    }
    if (!ok) return; // no map to fold back into — the CSS fade alone will do
    workerRef.current?.postMessage({ type: "stop" });
    morphRef.current = {
      from: posRef.current.slice(),
      to,
      fromView: { ...viewRef.current },
      t0: performance.now(),
    };
  }, [exiting, nodes, projectNode]);

  // --- the frame the whole graph should fit in ---
  const fitTarget = useCallback(() => {
    const pos = posRef.current;
    if (!pos || !size.w) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < pos.length; i += 2) {
      const x = pos[i], y = pos[i + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (!Number.isFinite(minX)) return null;
    const pad = 40;
    const k = Math.max(
      0.05,
      Math.min(
        3,
        Math.min(
          (size.w - pad * 2) / Math.max(maxX - minX, 1),
          (size.h - pad * 2) / Math.max(maxY - minY, 1)
        )
      )
    );
    return {
      k,
      tx: size.w / 2 - ((minX + maxX) / 2) * k,
      ty: size.h / 2 - ((minY + maxY) / 2) * k,
    };
  }, [size.w, size.h]);

  const fitNow = useCallback(() => {
    const t = fitTarget();
    if (t) viewRef.current = t;
    userMovedRef.current = false;
  }, [fitTarget]);

  // --- draw loop. Depends on the canvas SIZE and nothing else. ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size.w || !size.h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    const ctx = canvas.getContext("2d");

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      const s = sceneRef.current;
      const now = performance.now();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.w, size.h); // transparent: the map shows through beneath

      let pos = posRef.current;
      if (!pos || !s.nodes.length) return;

      // Folding back onto the map: interpolate BOTH the positions and the camera, so the
      // nodes land exactly on their map pins rather than on a panned-and-zoomed ghost of them.
      const m = morphRef.current;
      if (m) {
        const e = easeInOut(clamp01((now - m.t0) / MORPH_MS));
        const lerped = new Float32Array(m.from.length);
        for (let i = 0; i < m.from.length; i += 1) {
          lerped[i] = m.from[i] + (m.to[i] - m.from[i]) * e;
        }
        pos = lerped;
        viewRef.current = {
          k: m.fromView.k + (1 - m.fromView.k) * e,
          tx: m.fromView.tx + (0 - m.fromView.tx) * e,
          ty: m.fromView.ty + (0 - m.fromView.ty) * e,
        };
      } else if (!userMovedRef.current && framesRef.current % 8 === 0) {
        // Ease the camera toward the fit rather than snapping to it once at the end: the
        // graph is expanding while you watch, and a single jump when it stops reads as a bug.
        const t = fitTarget();
        if (t) {
          const v = viewRef.current;
          viewRef.current = {
            k: v.k + (t.k - v.k) * 0.12,
            tx: v.tx + (t.tx - v.tx) * 0.12,
            ty: v.ty + (t.ty - v.ty) * 0.12,
          };
        }
      }
      framesRef.current += 1;

      // Probe hook, matching MapView's `window.__ugnayMap`. The camera lives in a ref (it has
      // to — it changes every frame), so a test has no other way to assert that a gesture
      // ZOOMED IN rather than merely "changed the pixels". Inferring direction from a pixel
      // count is how a pinch that zooms the wrong way passes as a pass.
      if (typeof window !== "undefined") window.__ugnayNetView = viewRef.current;

      const intro = introRef.current
        ? clamp01((now - introRef.current) / INTRO_MS)
        : 1;

      const { k, tx, ty } = viewRef.current;
      const X = (i) => pos[i * 2] * k + tx;
      const Y = (i) => pos[i * 2 + 1] * k + ty;

      const filtering = s.netVerdicts.size > 0;
      const { nodes: ns, edges: es, statuses: st, indexOf: idx } = s;

      // Edges first, underneath. Thin and pale: they are the evidence, not the subject —
      // the subject is which nodes have none. They recede further when a verdict is lit,
      // so the highlight has something to be brighter *than*.
      ctx.globalAlpha = intro;
      ctx.lineWidth = Math.max(0.4, 0.7 * k);
      ctx.strokeStyle = filtering ? EDGE_MUTED : EDGE;
      ctx.beginPath();
      for (const e of es) {
        if (e.reskilling) continue;
        const a = idx.get(e.source);
        const b = idx.get(e.target);
        if (a === undefined || b === undefined) continue;
        ctx.moveTo(X(a), Y(a));
        ctx.lineTo(X(b), Y(b));
      }
      ctx.stroke();

      if (s.showReskilling) {
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = EDGE_RESKILL;
        ctx.beginPath();
        for (const e of es) {
          if (!e.reskilling) continue;
          const a = idx.get(e.source);
          const b = idx.get(e.target);
          if (a === undefined || b === undefined) continue;
          ctx.moveTo(X(a), Y(a));
          ctx.lineTo(X(b), Y(b));
        }
        ctx.stroke();
        ctx.restore();
      }

      const zoom = Math.max(0.6, Math.min(k, 1.8));

      // Pass 1 — the field. Every node, in its sector colour if the user asked for that
      // sector and neutral grey otherwise; pushed right back if a verdict is lit.
      for (let i = 0; i < ns.length; i += 1) {
        const status = st[i];
        const lit = filtering && s.netVerdicts.has(status);
        if (lit) continue; // drawn in pass 2, on top
        const x = X(i), y = Y(i);
        if (x < -20 || y < -20 || x > size.w + 20 || y > size.h + 20) continue;

        const fk = fillKey(ns[i]);
        const coloured = s.netFills.has(fk);
        // A tile with no verdict in it is a BUILD failure, not a quiet institution — it
        // keeps shouting regardless of what is filtered.
        const fill = status === "unknown"
          ? STATUS_STYLE.unknown.color
          : coloured
            ? s.sectorColors[fk]
            : NEUTRAL_FILL;

        ctx.globalAlpha = intro * (filtering ? DIM_ALPHA : coloured ? 0.95 : 0.8);
        ctx.fillStyle = fill;
        drawShape(ctx, s.nodeShapes[fk] || "circle", x, y, (coloured ? 3.4 : 3) * zoom);
        ctx.fill();
      }

      // Pass 2 — the answer. Lit nodes get a soft halo in the verdict's colour, full
      // opacity and a size bump; worst last, so a cut node is never buried under a
      // complete one it happens to overlap.
      if (filtering) {
        for (const status of STATUS_ORDER) {
          if (!s.netVerdicts.has(status)) continue;
          const col = STATUS_STYLE[status].color;
          for (let i = 0; i < ns.length; i += 1) {
            if (st[i] !== status) continue;
            const x = X(i), y = Y(i);
            if (x < -20 || y < -20 || x > size.w + 20 || y > size.h + 20) continue;
            const fk = fillKey(ns[i]);
            const r = 4.2 * zoom;

            ctx.globalAlpha = intro * 0.3;
            ctx.fillStyle = col;
            ctx.beginPath();
            ctx.arc(x, y, r + 3.5, 0, Math.PI * 2);
            ctx.fill();

            ctx.globalAlpha = intro;
            ctx.fillStyle = s.netFills.has(fk) ? s.sectorColors[fk] : NEUTRAL_FILL;
            drawShape(ctx, s.nodeShapes[fk] || "circle", x, y, r);
            ctx.fill();
            ctx.strokeStyle = col;
            ctx.lineWidth = 1.4;
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;

      // Selection + hover rings
      for (const target of [s.selectedNode, s.hover?.node]) {
        if (!target) continue;
        const i = idx.get(target.node_id);
        if (i === undefined) continue;
        ctx.beginPath();
        ctx.arc(X(i), Y(i), 9, 0, Math.PI * 2);
        ctx.strokeStyle = target === s.selectedNode ? "#0F172A" : "#64748B";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [size.w, size.h, fitTarget]);

  // --- pointer: hit-test in screen space ---
  const pick = useCallback(
    (sx, sy) => {
      const pos = posRef.current;
      if (!pos) return null;
      const { k, tx, ty } = viewRef.current;
      let best = null;
      let bestD = 12 * 12; // px², generous — these are small marks
      for (let i = 0; i < nodes.length; i += 1) {
        const dx = pos[i * 2] * k + tx - sx;
        const dy = pos[i * 2 + 1] * k + ty - sy;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best == null ? null : { node: nodes[best], sx, sy };
    },
    [nodes]
  );

  // --- pointers: one finger pans, two pinch-zoom, a tap selects ---
  //
  // The canvas sets `touch-action: none`, which is what stops a drag from scrolling the page
  // — but it also disables the browser's native pinch-zoom. So on a phone, zoom only exists
  // if we implement it, and without zoom the view is useless there: at 390px wide a settled
  // province is a cloud of 4px dots, and the whole point is to inspect the broken ones.
  const pointersRef = useRef(new Map());
  const gestureRef = useRef(null);

  const localXY = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  // Zoom about a fixed screen point — the cursor, or the midpoint between two fingers.
  // Anchoring anywhere else slides whatever you are looking at out from under you.
  const zoomAbout = useCallback((sx, sy, nextK) => {
    const { k, tx, ty } = viewRef.current;
    const nk = Math.max(0.05, Math.min(nextK, 8));
    viewRef.current = {
      k: nk,
      tx: sx - ((sx - tx) / k) * nk,
      ty: sy - ((sy - ty) / k) * nk,
    };
    userMovedRef.current = true;
  }, []);

  // How far one wheel/pinch EVENT may move the zoom. Trackpads, mice and OSes disagree wildly
  // about what `deltaY` means — a pinch may arrive as a stream of ±3s or as a single ±120 —
  // and without a cap a generous device teleports you from "the whole province" to "inside one
  // node" in a single flick, with no way back but the Fit button.
  const STEP_MAX = 1.25;
  const stepFactor = (deltaY, scale) =>
    Math.max(1 / STEP_MAX, Math.min(STEP_MAX, Math.exp(-deltaY * scale)));

  // WHEEL AND TRACKPAD PINCH — bound by hand, because React cannot do this one.
  //
  // React registers `wheel` as a PASSIVE listener on the root, so `preventDefault()` inside
  // an `onWheel` prop is silently a no-op. That matters because a trackpad pinch does not
  // arrive as a touch gesture at all: it arrives as a `wheel` event with `ctrlKey` set. Left
  // undefaulted, the BROWSER acts on it and zooms the page, which changes the layout, which
  // fires our ResizeObserver, which restarts the entire force simulation. So the pinch both
  // fought our own zoom and reset the graph underneath it. It has to be a native listener
  // with `{ passive: false }`.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      // A pinch reports a much smaller deltaY than a wheel notch (single digits, vs ~100), so
      // it needs a stronger response per unit — but the step is capped either way.
      const scale = e.ctrlKey ? 0.012 : 0.0015;
      zoomAbout(sx, sy, viewRef.current.k * stepFactor(e.deltaY, scale));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomAbout]);

  const startGesture = () => {
    const pts = [...pointersRef.current.values()];
    if (pts.length === 1) {
      gestureRef.current = {
        type: "pan",
        x: pts[0].x,
        y: pts[0].y,
        moved: false,
        ...viewRef.current,
      };
    } else if (pts.length >= 2) {
      const [a, b] = pts;
      gestureRef.current = {
        type: "pinch",
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        ...viewRef.current,
      };
    }
  };

  const onPointerDown = (e) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setHover(null);
    startGesture();
    // Capture LAST, and never let it take the gesture down with it. `setPointerCapture`
    // throws NotFoundError for any pointer the browser does not consider active — which
    // includes every synthetic PointerEvent, so calling it first meant the whole handler
    // aborted before a single finger was registered and pinch silently did nothing.
    // Capture is an enhancement (it keeps a drag alive past the canvas edge), not a
    // precondition, so it must not be able to break panning or zooming.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already released, or synthetic — pan/pinch work regardless */
    }
  };

  const onPointerMove = (e) => {
    const [sx, sy] = localXY(e);

    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    const g = gestureRef.current;
    const pts = [...pointersRef.current.values()];

    if (g?.type === "pinch" && pts.length >= 2) {
      const [a, b] = pts;
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const rect = e.currentTarget.getBoundingClientRect();
      const mx = (a.x + b.x) / 2 - rect.left;
      const my = (a.y + b.y) / 2 - rect.top;
      viewRef.current = { k: g.k, tx: g.tx, ty: g.ty };
      zoomAbout(mx, my, g.k * (dist / g.dist));
      return;
    }

    if (g?.type === "pan") {
      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        g.moved = true;
        userMovedRef.current = true;
      }
      viewRef.current = { k: g.k, tx: g.tx + dx, ty: g.ty + dy };
      return;
    }

    // Hover is a MOUSE affordance. On touch there is no hover — a "hover" would just be the
    // finger that is already tapping — so the tooltip is suppressed and the tap opens the
    // drawer instead.
    if (!isMobile) setHover(pick(sx, sy));
  };

  const endPointer = (e) => {
    const g = gestureRef.current;
    pointersRef.current.delete(e.pointerId);

    // A tap: one pointer, never moved, and no pinch anywhere in the gesture.
    if (g?.type === "pan" && !g.moved && pointersRef.current.size === 0) {
      const [sx, sy] = localXY(e);
      const hit = pick(sx, sy);
      onNodeClick(hit ? hit.node : null);
    }

    // Lifting one finger of a pinch leaves the other still down — re-seat the gesture on
    // what remains, or the view snaps as the survivor is treated as a fresh pan from a
    // stale origin.
    gestureRef.current = null;
    if (pointersRef.current.size > 0) startGesture();
  };

  const nothingOn = netVerdicts.size === 0 && netFills.size === 0;

  return (
    <div ref={wrapRef} className="absolute inset-0 z-10 overflow-hidden">
      {/* The backdrop, NOT the canvas, is what hides the map. It fades up over the first
          half-second so the map is still visible beneath the unfolding graph — you watch
          geography turn into structure — and it fades back out on the way home. */}
      <div
        className="absolute inset-0 bg-slate-50 ease-out"
        style={{
          opacity: exiting ? 0 : bgOn ? 1 : 0,
          transition: `opacity ${exiting ? 260 : 700}ms ease-out`,
        }}
      />

      <canvas
        ref={canvasRef}
        // Named, because MapView stays mounted UNDERNEATH this view (unmounting it would
        // throw away its WebGL context) — so a bare `querySelector("canvas")` finds
        // MapLibre's, not this one. That is not a hypothetical: it silently sent a whole
        // pinch-zoom test to the wrong canvas.
        data-testid="network-canvas"
        style={{
          width: size.w,
          height: size.h,
          touchAction: "none",
          opacity: exiting ? 0 : 1,
          // Held at full opacity for most of the fold, then dissolved at the end — the nodes
          // have to REACH their map pins before they disappear, or the morph reads as a fade.
          transition: exiting ? "opacity 160ms ease-in 270ms" : "none",
        }}
        className="relative block cursor-crosshair"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        // A finger that leaves the surface, or a gesture the browser steals, fires
        // `pointercancel` and NOT `pointerup`. Without this the pointer stays in the map
        // forever and the next touch is treated as the second finger of a pinch that never
        // happened.
        onPointerCancel={endPointer}
        onPointerLeave={() => setHover(null)}
      />

      {/* Chrome sits BELOW the 48px header (top-14) and clear of the filter panel, which
          owns the top-right corner in both views — the threshold slider lives there and is
          as load-bearing here as it is on the map. */}
      <div className="absolute top-14 left-3 right-3 sm:right-auto flex flex-col gap-2 sm:max-w-[260px] pointer-events-none">
        <div className="flex items-center gap-2">
          {/* Pathway lens. The two verdicts are tracked separately, so they are READ
              separately — an SHS can be complete on one and cut on the other. This is the one
              control the view cannot do without, so it stays on-canvas at every size rather
              than being buried in the sheet. */}
          <div
            role="group"
            aria-label="Pathway"
            className="flex rounded-lg overflow-hidden shadow bg-white w-fit pointer-events-auto"
          >
            {Object.entries(PATHWAYS).map(([key, p]) => (
              <button
                key={key}
                onClick={() => onPathway(key)}
                // The header already has a "Tech-Voc" SECTOR toggle. Same words, different
                // job — so this one says what it actually switches.
                aria-label={`${p.label} pathway`}
                title={`Can a learner reach ${p.ends}?`}
                className={`px-3 text-xs font-medium transition-colors ${
                  // A 44px target on touch; the desktop control can be tighter.
                  isMobile ? "py-2.5 min-h-[44px]" : "py-1.5"
                } ${
                  pathway === key
                    ? "bg-slate-800 text-white"
                    : "bg-white text-gray-500 hover:bg-gray-50"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <button
            onClick={fitNow}
            aria-label="Fit graph to view"
            title="Fit the whole graph back into view"
            className={`rounded-lg shadow bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-800 transition-colors pointer-events-auto flex items-center justify-center ${
              isMobile ? "w-11 h-11" : "w-8 h-8 text-sm"
            }`}
          >
            ⤢
          </button>
        </div>

        {/* The framing question. Dropped on a phone: it is three lines of prose over a graph
            that only has ~600px of height to begin with, and the same sentence is the first
            thing in the legend tab. */}
        {!isMobile && (
          <div className="bg-white/95 backdrop-blur shadow rounded-lg px-3 py-2 text-[11px] text-gray-600 pointer-events-auto">
            Can a learner starting here reach{" "}
            <span className="font-semibold text-gray-800">{PATHWAYS[pathway].ends}</span>, in
            hops of {thresholdKm} km or less?
          </div>
        )}
      </div>

      {/* The readout is ALSO the filter — the numbers and the switch that acts on them are
          the same control. Putting the toggles anywhere else would mean reading a count here
          and then hunting for the thing that lights it up; and it makes the first move
          obvious, which matters on a canvas that deliberately starts bland.
          DESKTOP: bottom-right, sliding left of the detail drawer rather than being buried.
          MOBILE: one row, lifted clear of the collapsed sheet, hidden when the detail sheet
          is up — that sheet is 60dvh and would cover it anyway. */}
      <div
        data-testid="network-readout"
        className={`absolute bg-white/95 backdrop-blur shadow rounded-lg px-2.5 py-2 z-20
          transition-[transform,opacity] duration-300 ease-out ${
            isMobile
              ? `left-3 right-3 bottom-14 ${
                  selectedNode ? "opacity-0 pointer-events-none translate-y-2" : "opacity-100"
                }`
              : `right-3 bottom-3 w-[224px] ${selectedNode ? "-translate-x-72" : ""}`
          }`}
      >
        <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 mb-1.5 px-0.5">
          {stale ? "No verdicts" : "Highlight"} · {PATHWAYS[pathway].label} · {thresholdKm} km
        </div>

        {stale ? (
          <div className="flex items-center gap-2 text-[11px] px-1 py-0.5">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: STATUS_STYLE.unknown.color }}
            />
            <span className="flex-1 text-gray-600">{STATUS_STYLE.unknown.label}</span>
            <span className="tabular-nums font-medium text-gray-800">{counts.unknown}</span>
          </div>
        ) : (
          <div className={isMobile ? "flex items-stretch gap-1.5" : "space-y-0.5"}>
            {VERDICTS.map((s) => {
              const on = netVerdicts.has(s);
              const col = STATUS_STYLE[s].color;
              return (
                <button
                  key={s}
                  onClick={() => onToggleVerdict(s)}
                  aria-pressed={on}
                  title={
                    on
                      ? `Stop highlighting “${STATUS_STYLE[s].label}”`
                      : `Highlight “${STATUS_STYLE[s].label}” — the rest fade back`
                  }
                  className={`w-full rounded-md border transition-all ${
                    isMobile
                      ? "flex-1 min-w-0 px-1 py-1.5 text-center"
                      : "flex items-center gap-2 text-[11px] px-1.5 py-1"
                  } ${
                    on
                      ? "border-transparent"
                      : "border-transparent hover:bg-gray-50"
                  }`}
                  style={on ? { backgroundColor: `${col}14`, borderColor: `${col}55` } : undefined}
                >
                  {isMobile ? (
                    <>
                      <div className="flex items-center justify-center gap-1.5">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{
                            backgroundColor: on ? col : "transparent",
                            boxShadow: `inset 0 0 0 1.5px ${col}`,
                          }}
                        />
                        <span className="text-sm font-semibold tabular-nums text-gray-800">
                          {counts[s]}
                        </span>
                      </div>
                      <div className="text-[10px] leading-tight text-gray-500 truncate">
                        {STATUS_STYLE[s].label}
                      </div>
                    </>
                  ) : (
                    <>
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{
                          backgroundColor: on ? col : "transparent",
                          boxShadow: `inset 0 0 0 1.5px ${col}`,
                        }}
                      />
                      <span className={`flex-1 text-left ${on ? "text-gray-800 font-medium" : "text-gray-600"}`}>
                        {STATUS_STYLE[s].label}
                      </span>
                      <span className="tabular-nums font-medium text-gray-800">{counts[s]}</span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {!stale && !isMobile && (
          <div className="mt-1.5 pt-1.5 border-t border-gray-100 text-[10px] leading-snug text-gray-400 px-0.5">
            {nothingOn ? (
              <>
                Nothing is highlighted yet — that is the point.{" "}
                <span className="text-gray-600 font-medium">Pick a verdict</span> above, or
                colour a sector in the panel.
              </>
            ) : (
              <>{counts.na} not on this pathway</>
            )}
          </div>
        )}
      </div>

      {stale && (
        <div className="absolute top-28 sm:top-14 inset-x-3 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 z-30 sm:max-w-md bg-violet-50 border border-violet-300 text-violet-900 rounded-lg px-4 py-3 shadow-lg">
          <div className="text-xs font-semibold uppercase tracking-wide mb-1">
            No pathway verdicts in these tiles
          </div>
          <p className="text-[11px] leading-relaxed">
            The tiles loaded here were built before the progression stage (S7), so they carry
            no chain verdict. The structure below is real, but no institution can be judged
            because the answer simply isn’t in the data.{" "}
            <span className="font-medium">
              Re-run <code>scripts/s7_progression_chains.py</code> and{" "}
              <code>scripts/s6_tile_slicer.py</code>, then re-upload the tiles.
            </span>
          </p>
        </div>
      )}

      {settling && (
        <div className="absolute inset-x-0 top-0 h-0.5 bg-slate-200 z-20">
          {/* Driven by a direct style write from the worker's message handler, not React
              state: this bar updates ~60 times a second, and re-rendering the whole view
              that often is precisely what made the settle stutter. */}
          <div ref={barRef} className="h-full bg-slate-500" style={{ width: "0%" }} />
        </div>
      )}

      {!nodes.length && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">
          No institutions loaded.
        </div>
      )}

      {hover && !isMobile && (
        <div
          className="absolute pointer-events-none bg-slate-900 text-white text-[11px] rounded px-2 py-1.5 shadow-lg max-w-[240px] z-20"
          style={{ left: hover.sx + 12, top: hover.sy + 12 }}
        >
          <div className="font-medium leading-tight">{hover.node.name}</div>
          <div className="text-slate-300 mt-0.5">
            {SECTOR_LABEL[fillKey(hover.node)]} ·{" "}
            {STATUS_STYLE[chainStatus(hover.node, pathway, thresholdKm, nearestIndex)].label}
          </div>
        </div>
      )}
    </div>
  );
}
