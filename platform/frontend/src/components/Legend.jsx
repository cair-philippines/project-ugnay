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

// The key itself, without the floating shell — reused verbatim by the mobile sheet.
export function LegendBody({ sectorColors, nodeShapes, gapVisible, thresholdKm }) {
  return (
    <div className="text-xs text-gray-600 space-y-1">
      <div className="font-semibold text-gray-500 uppercase tracking-wide text-[10px] mb-1">
        Shape + fill = sector
      </div>
      {SECTORS.map(([k, label]) => (
        <div key={k} className="flex items-center gap-2">
          <ShapeMark shape={nodeShapes?.[k] || "circle"} color={sectorColors[k]} size={13} />
          {label}
        </div>
      ))}

      {gapVisible && (
        <div className="pt-1.5 mt-1 border-t border-gray-200 space-y-1">
          <div className="font-semibold text-gray-500 uppercase tracking-wide text-[10px]">
            Gap analysis
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full border-2 border-amber-500 shrink-0" />
            Next level exists, but beyond {thresholdKm} km by road
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full border-2 border-red-600 shrink-0" />
            No next level within 5 km by road
          </div>
          <p className="text-[10px] leading-snug text-gray-400 pt-0.5">
            A haloed <span className="font-semibold">TESDA</span> node is a training provider with
            no assessment center in reach. Matching is{" "}
            <span className="font-semibold">role-based only</span> — it does not yet check that the
            center assesses the qualification actually trained for, so this understates the true
            gap.
          </p>
        </div>
      )}

      <div className="pt-1.5 mt-1 border-t border-gray-200 text-[10px] leading-snug text-gray-500 space-y-1">
        <div>
          <span className="font-semibold">Tap or hover</span> an institution to see what’s reachable
          within {thresholdKm} km <span className="font-semibold">by road</span>.
        </div>
        <div>Edge colour = what it connects to · thickness = nearness.</div>
        <div className="text-gray-400">
          Distances are <span className="font-semibold">routed road distances</span> (OSRM) — how far
          you actually have to travel, not how far it looks. A line shows{" "}
          <span className="font-semibold">that</span> two institutions are connected, not the route
          taken.
        </div>
        <div className="text-gray-400">
          Edges remain an <span className="font-semibold">approximation of accessibility</span> —
          road distance is not travel time, cost, or safety, and says nothing about whether anyone
          actually enrols.
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
