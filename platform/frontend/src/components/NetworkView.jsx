import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import ForceWorker from "../workers/forceLayout.worker.js?worker";
import { fillKey, SECTOR_LABEL } from "../lib/graph";
import {
  progressionEdges,
  chainStatus,
  statusCounts,
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

  const dragRef = useRef(null);

  const onPointerDown = (e) => {
    dragRef.current = { x: e.clientX, y: e.clientY, moved: false, ...viewRef.current };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (dragRef.current) {
      const d = dragRef.current;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
      viewRef.current = { k: d.k, tx: d.tx + dx, ty: d.ty + dy };
      return;
    }
    setHover(pick(sx, sy));
  };

  const onPointerUp = (e) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.moved) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const hit = pick(e.clientX - rect.left, e.clientY - rect.top);
    onNodeClick(hit ? hit.node : null);
  };

  const onWheel = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const { k, tx, ty } = viewRef.current;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const nk = Math.max(0.05, Math.min(k * factor, 8));
    // Zoom about the cursor, not the origin — otherwise the thing you are pointing at
    // slides away from under you.
    viewRef.current = {
      k: nk,
      tx: sx - ((sx - tx) / k) * nk,
      ty: sy - ((sy - ty) / k) * nk,
    };
  };

  const settling = progress > 0 && progress < 0.99;

  return (
    <div ref={wrapRef} className="absolute inset-0 z-10 bg-slate-50 overflow-hidden">
      <canvas
        ref={canvasRef}
        style={{ width: size.w, height: size.h, touchAction: "none" }}
        className="block cursor-crosshair"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onWheel={onWheel}
      />

      {/* Chrome sits BELOW the 48px header (top-14) and clear of the filter panel, which
          owns the top-right corner in both views — the threshold slider lives there and is
          as load-bearing here as it is on the map. */}
      <div className="absolute top-14 left-3 flex flex-col gap-2 max-w-[250px]">
        {/* Pathway lens. The two verdicts are tracked separately, so they are READ
            separately — an SHS can be complete on one and cut on the other. */}
        <div
          role="group"
          aria-label="Pathway"
          className="flex rounded-lg overflow-hidden shadow bg-white w-fit"
        >
          {Object.entries(PATHWAYS).map(([key, p]) => (
            <button
              key={key}
              onClick={() => onPathway(key)}
              // The header already has a "Tech-Voc" SECTOR toggle. Same words, different
              // job — so this one says what it actually switches.
              aria-label={`${p.label} pathway`}
              title={`Can a learner reach ${p.ends}?`}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                pathway === key
                  ? "bg-slate-800 text-white"
                  : "bg-white text-gray-500 hover:bg-gray-50"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="bg-white/95 backdrop-blur shadow rounded-lg px-3 py-2 text-[11px] text-gray-600">
          Can a learner starting here reach{" "}
          <span className="font-semibold text-gray-800">{PATHWAYS[pathway].ends}</span>, in
          hops of {thresholdKm} km or less?
        </div>
      </div>

      {/* The readout. Bottom-RIGHT: the filter panel owns the top-right. The dead-end count
          is the number the map cannot produce.
          It slides left of the detail drawer when one opens — the drawer is 18rem and would
          otherwise bury it, and the counts are exactly what you want to keep an eye on while
          inspecting a node. */}
      <div
        data-testid="network-readout"
        className={`absolute bottom-3 right-3 bg-white/95 backdrop-blur shadow rounded-lg px-3 py-2 min-w-[200px] z-20
          transition-transform duration-300 ease-out ${
            selectedNode && !isMobile ? "-translate-x-72" : ""
          }`}
      >
        <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 mb-1.5">
          {PATHWAYS[pathway].label} pathway · {thresholdKm} km
        </div>
        {["cut", "deadend", "complete"].map((s) => (
          <div key={s} className="flex items-center gap-2 text-[11px] py-0.5">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: STATUS_STYLE[s].fill }}
            />
            <span className="flex-1 text-gray-600">{STATUS_STYLE[s].label}</span>
            <span className="tabular-nums font-medium text-gray-800">{counts[s]}</span>
          </div>
        ))}
        {counts.na > 0 && (
          <div className="mt-1 pt-1 border-t border-gray-100 text-[10px] text-gray-400">
            {counts.na} not on this pathway
          </div>
        )}
      </div>

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
