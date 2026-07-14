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
// Rendered on a CANVAS, not SVG: a region is ~6,700 nodes and ~25,000 edges, and that many
// DOM elements would make hover alone a slideshow. Layout runs in a worker (see
// workers/forceLayout.worker.js).

const BG = "#F8FAFC";
const EDGE = "rgba(100,116,139,0.22)";
const EDGE_RESKILL = "rgba(168,85,247,0.35)";

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
  selectedNode,
  onNodeClick,
  isMobile,
}) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const workerRef = useRef(null);
  const posRef = useRef(null); // Float32Array [x0,y0,x1,y1,…], parallel to `nodes`
  const viewRef = useRef({ k: 1, tx: 0, ty: 0 });
  const rafRef = useRef(0);
  const fittedRef = useRef(false);

  const [progress, setProgress] = useState(0);
  const [hover, setHover] = useState(null); // { node, sx, sy }
  const [size, setSize] = useState({ w: 0, h: 0 });

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

  const indexOf = useMemo(
    () => new Map(nodes.map((n, i) => [n.node_id, i])),
    [nodes]
  );

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

  // --- layout ---
  useEffect(() => {
    if (!size.w || !size.h || !nodes.length) return;

    const worker = new ForceWorker();
    workerRef.current = worker;
    fittedRef.current = false;
    setProgress(0);

    worker.onmessage = (e) => {
      const { type, positions, progress: p, done } = e.data;
      if (type !== "tick") return;
      posRef.current = positions;
      setProgress(p);
      if (done) fittedRef.current = false; // re-fit once it has settled
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
    });

    return () => {
      worker.postMessage({ type: "stop" });
      worker.terminate();
      workerRef.current = null;
    };
  }, [nodes, edges, size.w, size.h]);

  // --- fit the settled graph to the viewport ---
  const fit = useCallback(() => {
    const pos = posRef.current;
    if (!pos || !nodes.length || !size.w) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < nodes.length; i += 1) {
      const x = pos[i * 2], y = pos[i * 2 + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (!Number.isFinite(minX)) return;
    const pad = 40;
    const k = Math.min(
      (size.w - pad * 2) / Math.max(maxX - minX, 1),
      (size.h - pad * 2) / Math.max(maxY - minY, 1)
    );
    const kk = Math.max(0.05, Math.min(k, 3));
    viewRef.current = {
      k: kk,
      tx: size.w / 2 - ((minX + maxX) / 2) * kk,
      ty: size.h / 2 - ((minY + maxY) / 2) * kk,
    };
  }, [nodes.length, size.w, size.h]);

  // --- draw loop ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size.w || !size.h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    const ctx = canvas.getContext("2d");

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      const pos = posRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, size.w, size.h);
      if (!pos) return;

      if (!fittedRef.current && progress > 0.99) {
        fit();
        fittedRef.current = true;
      }

      const { k, tx, ty } = viewRef.current;
      const X = (i) => pos[i * 2] * k + tx;
      const Y = (i) => pos[i * 2 + 1] * k + ty;

      // Edges first, underneath. Thin and pale: they are the evidence, not the subject —
      // the subject is which nodes have none.
      ctx.lineWidth = Math.max(0.4, 0.7 * k);
      ctx.strokeStyle = EDGE;
      ctx.beginPath();
      for (const e of edges) {
        if (e.reskilling) continue;
        const a = indexOf.get(e.source);
        const b = indexOf.get(e.target);
        if (a === undefined || b === undefined) continue;
        ctx.moveTo(X(a), Y(a));
        ctx.lineTo(X(b), Y(b));
      }
      ctx.stroke();

      if (showReskilling) {
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = EDGE_RESKILL;
        ctx.beginPath();
        for (const e of edges) {
          if (!e.reskilling) continue;
          const a = indexOf.get(e.source);
          const b = indexOf.get(e.target);
          if (a === undefined || b === undefined) continue;
          ctx.moveTo(X(a), Y(a));
          ctx.lineTo(X(b), Y(b));
        }
        ctx.stroke();
        ctx.restore();
      }

      // Nodes, worst last — a red dead-end must never be buried under the pale healthy
      // mass it is surrounded by.
      for (const status of STATUS_ORDER) {
        const style = STATUS_STYLE[status];
        ctx.globalAlpha = style.alpha;
        for (let i = 0; i < nodes.length; i += 1) {
          if (statuses[i] !== status) continue;
          const x = X(i), y = Y(i);
          if (x < -20 || y < -20 || x > size.w + 20 || y > size.h + 20) continue;
          const r = style.r * Math.max(0.6, Math.min(k, 1.8));
          ctx.fillStyle = style.fill;
          drawShape(ctx, nodeShapes[fillKey(nodes[i])] || "circle", x, y, r);
          ctx.fill();
          // A hairline in the SECTOR colour, so severity (fill) and sector (shape + ring)
          // are both legible without spending the fill on two things at once.
          if (r > 2) {
            ctx.strokeStyle = sectorColors[fillKey(nodes[i])];
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;

      // Selection + hover rings
      for (const target of [selectedNode, hover?.node]) {
        if (!target) continue;
        const i = indexOf.get(target.node_id);
        if (i === undefined) continue;
        ctx.beginPath();
        ctx.arc(X(i), Y(i), 9, 0, Math.PI * 2);
        ctx.strokeStyle = target === selectedNode ? "#0F172A" : "#64748B";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [
    size, edges, nodes, statuses, indexOf, nodeShapes, sectorColors,
    selectedNode, hover, showReskilling, progress, fit,
  ]);

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
  const zoomAbout = (sx, sy, nextK) => {
    const { k, tx, ty } = viewRef.current;
    const nk = Math.max(0.05, Math.min(nextK, 8));
    viewRef.current = {
      k: nk,
      tx: sx - ((sx - tx) / k) * nk,
      ty: sy - ((sy - ty) / k) * nk,
    };
  };

  const startGesture = (e) => {
    const pts = [...pointersRef.current.values()];
    if (pts.length === 1) {
      gestureRef.current = { type: "pan", x: pts[0].x, y: pts[0].y, moved: false, ...viewRef.current };
    } else if (pts.length >= 2) {
      const [a, b] = pts;
      gestureRef.current = {
        type: "pinch",
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
        ...viewRef.current,
      };
    }
  };

  const onPointerDown = (e) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setHover(null);
    startGesture(e);
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
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) g.moved = true;
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
    if (pointersRef.current.size > 0) startGesture(e);
  };

  const onWheel = (e) => {
    const [sx, sy] = localXY(e);
    zoomAbout(sx, sy, viewRef.current.k * Math.exp(-e.deltaY * 0.0015));
  };

  const settling = progress > 0 && progress < 0.99;

  return (
    <div ref={wrapRef} className="absolute inset-0 z-10 bg-slate-50 overflow-hidden">
      <canvas
        ref={canvasRef}
        // Named, because MapView stays mounted UNDERNEATH this view (unmounting it would
        // throw away its WebGL context) — so a bare `querySelector("canvas")` finds
        // MapLibre's, not this one. That is not a hypothetical: it silently sent a whole
        // pinch-zoom test to the wrong canvas.
        data-testid="network-canvas"
        style={{ width: size.w, height: size.h, touchAction: "none" }}
        className="block cursor-crosshair"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        // A finger that leaves the surface, or a gesture the browser steals, fires
        // `pointercancel` and NOT `pointerup`. Without this the pointer stays in the map
        // forever and the next touch is treated as the second finger of a pinch that never
        // happened.
        onPointerCancel={endPointer}
        onPointerLeave={() => setHover(null)}
        onWheel={onWheel}
      />

      {/* Chrome sits BELOW the 48px header (top-14) and clear of the filter panel, which
          owns the top-right corner in both views — the threshold slider lives there and is
          as load-bearing here as it is on the map. */}
      <div className="absolute top-14 left-3 right-3 sm:right-auto flex flex-col gap-2 sm:max-w-[250px] pointer-events-none">
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

      {/* The readout — the dead-end count is the number the map cannot produce, so it stays
          visible in both chromes.
          DESKTOP: bottom-right (the filter panel owns the top-right), sliding left of the
          detail drawer when one opens rather than being buried by it.
          MOBILE: lifted clear of the collapsed bottom sheet (44px) and laid out as one row,
          because a 200px card stacked three-high eats a third of a phone's graph. It hides
          entirely when the detail sheet is up — that sheet is 60dvh and would cover it
          anyway, and racing it would just be two panels fighting over one corner. */}
      <div
        data-testid="network-readout"
        className={`absolute bg-white/95 backdrop-blur shadow rounded-lg px-3 py-2 z-20
          transition-[transform,opacity] duration-300 ease-out ${
            isMobile
              ? `left-3 right-3 bottom-14 ${
                  selectedNode ? "opacity-0 pointer-events-none translate-y-2" : "opacity-100"
                }`
              : `right-3 bottom-3 min-w-[200px] ${selectedNode ? "-translate-x-72" : ""}`
          }`}
      >
        <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 mb-1.5">
          {PATHWAYS[pathway].label} pathway · {thresholdKm} km
        </div>

        {isMobile ? (
          // One row: swatch over count, label beneath. The numbers are what you are here for,
          // so they get the size; the words shrink to fit around them.
          <div className="flex items-stretch justify-between gap-2">
            {(stale ? ["unknown"] : ["cut", "deadend", "complete"]).map((s) => (
              <div key={s} className="flex-1 min-w-0 text-center">
                <div className="flex items-center justify-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: STATUS_STYLE[s].fill }}
                  />
                  <span className="text-sm font-semibold tabular-nums text-gray-800">
                    {counts[s]}
                  </span>
                </div>
                <div className="text-[10px] leading-tight text-gray-500 truncate">
                  {STATUS_STYLE[s].label}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {(stale ? ["unknown"] : ["cut", "deadend", "complete"]).map((s) => (
              <div key={s} className="flex items-center gap-2 text-[11px] py-0.5">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: STATUS_STYLE[s].fill }}
                />
                <span className="flex-1 text-gray-600">{STATUS_STYLE[s].label}</span>
                <span className="tabular-nums font-medium text-gray-800">{counts[s]}</span>
              </div>
            ))}
            {!stale && counts.na > 0 && (
              <div className="mt-1 pt-1 border-t border-gray-100 text-[10px] text-gray-400">
                {counts.na} not on this pathway
              </div>
            )}
          </>
        )}
      </div>

      {stale && (
        <div className="absolute top-28 sm:top-14 inset-x-3 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 z-30 sm:max-w-md bg-violet-50 border border-violet-300 text-violet-900 rounded-lg px-4 py-3 shadow-lg">
          <div className="text-xs font-semibold uppercase tracking-wide mb-1">
            No pathway verdicts in these tiles
          </div>
          <p className="text-[11px] leading-relaxed">
            The tiles loaded here were built before the progression stage (S7), so they carry
            no chain verdict. The structure below is real, but every institution is showing as
            “not on this pathway” because the answer simply isn’t in the data.{" "}
            <span className="font-medium">
              Re-run <code>scripts/s7_progression_chains.py</code> and{" "}
              <code>scripts/s6_tile_slicer.py</code>, then re-upload the tiles.
            </span>
          </p>
        </div>
      )}

      {settling && (
        <div className="absolute inset-x-0 top-0 h-0.5 bg-slate-200 z-20">
          <div
            className="h-full bg-slate-500 transition-[width] duration-150"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
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
