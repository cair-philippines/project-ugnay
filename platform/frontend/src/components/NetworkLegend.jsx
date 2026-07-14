import { useState } from "react";
import ShapeMark from "./ShapeMark";
import { PATHWAYS } from "../lib/progression";

// Legend for the network view. Same collapsible, bottom-anchored shell as the map's, but a
// DIFFERENT grammar — and saying so is the point. Here, fill carries the verdict and shape
// carries the sector; on the map, fill carries the sector. Two views, two jobs.
//
// The caveat band is not decoration. This view makes a strong claim ("this school's
// pathway goes nowhere"), and a strong claim has to carry its limits with it.

const SECTORS = [
  ["public", "DepEd Public"],
  ["private", "DepEd Private"],
  ["hei_public", "Higher Ed — Public"],
  ["hei_private", "Higher Ed — Private"],
  ["tesda", "TESDA"],
];

function SectionLabel({ children, className = "" }) {
  return (
    <div
      className={`text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 ${className}`}
    >
      {children}
    </div>
  );
}

// The key itself, without the floating shell — reused verbatim as a tab inside the mobile
// bottom sheet, exactly as the map's LegendBody is. A phone cannot afford a second floating
// panel; it can afford a tab.
export function NetworkLegendBody({
  sectorColors,
  nodeShapes,
  pathway,
  thresholdKm,
  showReskilling,
  onToggleReskilling,
}) {
  return (
    <div className="text-xs">
      <p className="text-[11px] leading-relaxed text-gray-600">
        Position is <span className="font-medium text-gray-800">structure, not place</span>.
        Institutions are pulled together by the pathways between them, so one whose pathway
        goes nowhere has nothing holding it in — it drifts to the edge.
      </p>

      <div className="mt-3 pt-3 border-t border-gray-200">
        <SectionLabel className="mb-1.5">Fill = the verdict</SectionLabel>
        <div className="space-y-1 text-gray-700">
          <div className="flex items-start gap-2.5">
            <span className="w-3 h-3 rounded-full bg-[#DC2626] shrink-0 mt-0.5" />
            <span>
              <span className="font-medium">Cut</span> — no next step at all within{" "}
              {thresholdKm} km.
            </span>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="w-3 h-3 rounded-full bg-[#F59E0B] shrink-0 mt-0.5" />
            <span>
              <span className="font-medium">Dead-end chain</span> — there IS a next step, but
              nothing downstream ever reaches {PATHWAYS[pathway].ends}.{" "}
              <span className="text-gray-500">The map cannot show you this one.</span>
            </span>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="w-3 h-3 rounded-full bg-[#94A3B8] shrink-0 mt-0.5" />
            <span>
              <span className="font-medium">Complete</span> — the chain closes.
            </span>
          </div>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-gray-200">
        <SectionLabel className="mb-1.5">Shape + ring = sector</SectionLabel>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {SECTORS.map(([k, label]) => (
            <div key={k} className="flex items-center gap-2 text-[11px] text-gray-700">
              <ShapeMark shape={nodeShapes?.[k] || "circle"} color={sectorColors[k]} size={11} />
              <span className="truncate">{label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-gray-200">
        <label className="flex items-center gap-2 text-[11px] text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={showReskilling}
            onChange={onToggleReskilling}
            className="accent-purple-500"
          />
          Show higher-ed → TESDA reskilling links
        </label>
        <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
          Real, and encouraged — but they are drawn as a dashed overlay and{" "}
          <span className="font-medium text-gray-700">never complete a pathway</span>. A chain
          that could double back through a university would call almost everything complete.
        </p>
      </div>

      <div className="mt-3 pt-3 border-t border-gray-200">
        <SectionLabel className="mb-1.5 text-slate-500">What this does not say</SectionLabel>
        <div className="border-l-2 border-slate-300 pl-2.5 space-y-1.5 text-[11px] leading-relaxed text-gray-500">
          <p>
            A chain is a sequence of{" "}
            <span className="font-medium text-gray-700">local moves</span>, each within{" "}
            {thresholdKm} km — not one commute. Four hops can still add up to a long way from
            home.
          </p>
          <p>
            The <span className="font-medium text-gray-700">verdict</span> is computed
            nationwide, so it is true regardless of the area you loaded. The{" "}
            <span className="font-medium text-gray-700">lines</span> can only be drawn between
            institutions you have actually loaded — a node near the edge of your selection may
            have neighbours off-screen.
          </p>
          <p>
            TESDA matching is{" "}
            <span className="font-medium text-gray-700">role-based only</span> — it does not
            check that the assessment centre assesses the qualification trained for, so
            tech-voc completeness is{" "}
            <span className="font-medium text-gray-700">optimistic</span>.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function NetworkLegend(props) {
  const [open, setOpen] = useState(true);

  return (
    <div className="absolute bottom-3 left-3 z-20 flex flex-col justify-end pointer-events-none">
      {/* Width pinned in both states: the collapsed body still drives the box's intrinsic
          width, so a shrink-to-fit shell would size the "collapsed" pill to the widest
          caveat line. (Same trap as the map legend.) */}
      <div className="w-[310px] bg-white/95 backdrop-blur shadow rounded-lg overflow-hidden">
        <button
          onClick={() => setOpen((v) => !v)}
          title={open ? "Collapse legend" : "Expand legend"}
          className="pointer-events-auto w-full flex items-center gap-2 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500 transition-colors hover:text-gray-800 hover:bg-gray-50"
        >
          <span className="text-gray-400 text-xs leading-none">{open ? "⌄" : "⌃"}</span>
          How to read this
        </button>

        <div
          aria-hidden={!open}
          inert={!open}
          className={`transition-all duration-300 ease-out overflow-hidden ${
            open ? "max-h-[calc(100vh-13rem)] opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          <div className="px-3 pb-2.5 pt-2 border-t border-gray-100 pointer-events-auto overflow-y-auto max-h-[calc(100vh-13rem)]">
            <NetworkLegendBody {...props} />
          </div>
        </div>
      </div>
    </div>
  );
}
