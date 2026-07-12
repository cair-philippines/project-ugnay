import { useState } from "react";
import ShapeMark from "./ShapeMark";

// Bottom-left legend. Anchored to the bottom, so expanding grows it upward: the bottom
// edge stays put and the panel unfurls into the map. Collapses to a pill, because the
// gap-analysis caveat makes it tall enough to eat a third of the map.
//
// The shell is pointer-events-none so map clicks pass straight through the legend body;
// only the header — the part you actually click — takes pointer events back.
//
// On MOBILE this component isn't rendered at all: `LegendBody` is exported and shown as a
// tab inside the bottom sheet instead, because a floating legend and a bottom sheet would
// fight over the same corner of a small screen.

const SECTORS = [
  ["public", "DepEd Public"],
  ["private", "DepEd Private"],
  ["hei_public", "Higher Ed — Public"],
  ["hei_private", "Higher Ed — Private"],
  ["tesda", "TESDA"],
];

// A section label. One consistent typographic device for every band of the legend, so the
// panel reads as a structured document rather than paragraphs of grey text stacked up.
function SectionLabel({ children, className = "" }) {
  return (
    <div
      className={`text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 ${className}`}
    >
      {children}
    </div>
  );
}

// A definition row: term on the left, meaning on the right. Turns "Edge colour = what it
// connects to · thickness = nearness" from a run-on sentence into something scannable.
function Def({ term, children }) {
  return (
    <div className="flex gap-2 leading-snug">
      <span className="w-[70px] shrink-0 text-gray-400">{term}</span>
      <span className="flex-1 text-gray-600">{children}</span>
    </div>
  );
}

// The key itself, without the floating shell — reused verbatim by the mobile sheet.
//
// Three bands, in the order a reader needs them: what the marks MEAN → how to USE the map →
// what the map does NOT claim. The caveats are load-bearing (they were written to keep the
// tool honest), so they stay on screen; what they get is structure — a heading, an accent
// rule, and their own indent — instead of being grey text trailing off the bottom.
export function LegendBody({ sectorColors, nodeShapes, gapVisible, thresholdKm }) {
  return (
    <div className="text-xs">
      <SectionLabel className="mb-1.5">Shape + fill = sector</SectionLabel>
      <div className="space-y-1">
        {SECTORS.map(([k, label]) => (
          <div key={k} className="flex items-center gap-2.5 text-gray-700">
            <ShapeMark shape={nodeShapes?.[k] || "circle"} color={sectorColors[k]} size={13} />
            {label}
          </div>
        ))}
      </div>

      {gapVisible && (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <SectionLabel className="mb-1.5">Gap analysis</SectionLabel>
          <div className="space-y-1 text-gray-700">
            <div className="flex items-center gap-2.5">
              <span className="w-3 h-3 rounded-full border-2 border-amber-500 shrink-0" />
              Next level exists, but beyond {thresholdKm} km by road
            </div>
            <div className="flex items-center gap-2.5">
              <span className="w-3 h-3 rounded-full border-2 border-red-600 shrink-0" />
              No next level within 5 km by road
            </div>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
            A haloed <span className="font-medium text-gray-700">TESDA</span> node is a training
            provider with no assessment center in reach. Matching is{" "}
            <span className="font-medium text-gray-700">role-based only</span> — it does not check
            that the center assesses the qualification actually trained for, so it{" "}
            <span className="font-medium text-gray-700">understates</span> the true gap.
          </p>
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-gray-200">
        <SectionLabel className="mb-1.5">How to read it</SectionLabel>
        <div className="space-y-1 text-[11px]">
          <Def term="Tap a node">
            see everything reachable within{" "}
            <span className="font-medium text-gray-800">{thresholdKm} km by road</span> that offers
            something it doesn’t.
          </Def>
          <Def term="Edge colour">what it connects you to.</Def>
          <Def term="Thickness">nearness — thicker is closer.</Def>
        </div>
      </div>

      {/* The honesty band. An accent rule and a heading, because these are limits on what the
          map may be used to claim — not footnotes. */}
      <div className="mt-3 pt-3 border-t border-gray-200">
        <SectionLabel className="mb-1.5 text-slate-500">What this does not say</SectionLabel>
        <div className="border-l-2 border-slate-300 pl-2.5 space-y-1.5 text-[11px] leading-relaxed text-gray-500">
          <p>
            Distances are <span className="font-medium text-gray-700">routed road distances</span>{" "}
            (OSRM) — how far you must actually travel, not how far it looks.
          </p>
          <p>
            A line means two institutions are{" "}
            <span className="font-medium text-gray-700">connected</span> — not the route taken.
          </p>
          <p>
            Road distance is <span className="font-medium text-gray-700">not</span> travel time,
            cost, or safety, and says nothing about whether anyone actually enrols.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function Legend({ sectorColors, nodeShapes, gapVisible, thresholdKm }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="absolute bottom-3 left-3 z-10 flex flex-col justify-end pointer-events-none">
      {/* Fixed width in both states. Collapsing only clips the body's HEIGHT — the body is
          still in the layout, so a shrink-to-fit box would take its widest line (the
          caveat paragraph) and the "collapsed" pill would end up wider than the panel. */}
      <div className="w-[300px] bg-white/95 backdrop-blur shadow rounded-lg overflow-hidden">
        <button
          onClick={() => setOpen((v) => !v)}
          title={open ? "Collapse legend" : "Expand legend"}
          className="pointer-events-auto w-full flex items-center gap-2 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500 transition-colors hover:text-gray-800 hover:bg-gray-50"
        >
          <span className="text-gray-400 text-xs leading-none">{open ? "⌄" : "⌃"}</span>
          Legend
          {!open && (
            <span className="flex items-center gap-1 ml-1">
              {SECTORS.map(([k]) => (
                <ShapeMark key={k} shape={nodeShapes?.[k] || "circle"} color={sectorColors[k]} size={9} />
              ))}
            </span>
          )}
        </button>

        <div
          aria-hidden={!open}
          inert={!open}
          className={`transition-all duration-300 ease-out overflow-hidden
            ${open ? "max-h-[calc(100vh-12rem)] opacity-100" : "max-h-0 opacity-0"}`}
        >
          <div className="px-3 pb-2 border-t border-gray-100 pt-2 overflow-y-auto max-h-[calc(100vh-12rem)]">
            <LegendBody
              sectorColors={sectorColors}
              nodeShapes={nodeShapes}
              gapVisible={gapVisible}
              thresholdKm={thresholdKm}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
