import { useState } from "react";
import ShapeMark from "./ShapeMark";
import { PATHWAYS, STATUS_STYLE, VERDICTS, NEUTRAL_FILL } from "../lib/progression";
import { SECTOR_GROUPS, SECTOR_LABEL } from "../lib/graph";

// Legend for the network view. Same collapsible, bottom-anchored shell as the map's — but a
// different grammar, and saying so plainly is most of its job.
//
// On the map, a mark's colour is simply WHAT IT IS. Here, colour is what you ASKED FOR:
// nothing is coloured and nothing is lit until a filter says so. That is not a stylistic
// choice, it is the honest one — a graph that answers three questions at once before you
// have asked any of them is a graph you cannot read.
//
// The caveat band is not decoration either. This view makes a strong claim ("this school's
// pathway goes nowhere"), and a strong claim has to carry its limits with it.

function SectionLabel({ children, className = "" }) {
  return (
    <div
      className={`text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 ${className}`}
    >
      {children}
    </div>
  );
}

const VERDICT_BLURB = {
  cut: (km) => (
    <>
      <span className="font-medium">Cut</span> — no next step at all within {km} km.
    </>
  ),
  deadend: (km, ends) => (
    <>
      <span className="font-medium">Dead-end chain</span> — there IS a next step, but nothing
      downstream ever reaches {ends}.{" "}
      <span className="text-gray-500">The map cannot show you this one.</span>
    </>
  ),
  complete: () => (
    <>
      <span className="font-medium">Complete</span> — the chain closes.
    </>
  ),
};

// The key itself, without the floating shell — reused verbatim as a tab inside the mobile
// bottom sheet, exactly as the map's LegendBody is. A phone cannot afford a second floating
// panel; it can afford a tab.
export function NetworkLegendBody({ sectorColors, nodeShapes, pathway, thresholdKm }) {
  const ends = PATHWAYS[pathway].ends;

  return (
    <div className="text-xs">
      <p className="text-[11px] leading-relaxed text-gray-600">
        Position is <span className="font-medium text-gray-800">structure, not place</span>.
        Institutions are pulled together by the pathways between them, so one whose pathway
        goes nowhere has nothing holding it in — it drifts to the edge.
      </p>

      <div className="mt-2.5 pt-2.5 border-t border-gray-200">
        <div className="flex items-start gap-2.5 text-[11px] leading-relaxed text-gray-600">
          <span
            className="w-3 h-3 rounded-full shrink-0 mt-0.5"
            style={{ backgroundColor: NEUTRAL_FILL }}
          />
          <span>
            Everything starts <span className="font-medium text-gray-800">grey</span>. The
            clusters and the loose specks are already the finding; the filters tell you{" "}
            <span className="font-medium text-gray-800">who</span> they are.
          </span>
        </div>
      </div>

      <div className="mt-2.5 pt-2.5 border-t border-gray-200">
        <SectionLabel className="mb-1.5">Highlight = the verdict</SectionLabel>
        <div className="space-y-1 text-gray-700">
          {VERDICTS.map((v) => (
            <div key={v} className="flex items-start gap-2.5">
              <span
                className="w-3 h-3 rounded-full shrink-0 mt-0.5"
                style={{
                  backgroundColor: `${STATUS_STYLE[v].color}33`,
                  boxShadow: `inset 0 0 0 1.5px ${STATUS_STYLE[v].color}`,
                }}
              />
              <span>{VERDICT_BLURB[v](thresholdKm, ends)}</span>
            </div>
          ))}
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-gray-500">
          Lighting one <span className="font-medium text-gray-700">fades the rest back</span>{" "}
          rather than deleting it — the point is that the cut ones sit at the RIM of the
          structure, and you cannot see a rim with nothing behind it.
        </p>
      </div>

      <div className="mt-2.5 pt-2.5 border-t border-gray-200">
        <SectionLabel className="mb-1.5">Fill = the sector (same as the map)</SectionLabel>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {SECTOR_GROUPS.flatMap((g) => g.fills).map((k) => (
            <div key={k} className="flex items-center gap-2 text-[11px] text-gray-700">
              <ShapeMark shape={nodeShapes?.[k] || "circle"} color={sectorColors[k]} size={11} />
              <span className="truncate">{SECTOR_LABEL[k]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* The caveats stay. This view makes a strong claim about a school's future, and a
          strong claim has to carry its limits with it. The CONTROLS that used to sit here
          (the reskilling toggle) have moved to the panel — a legend explains, it does not
          operate, and having the same switch in two places invited the reading that they were
          two different switches. */}
      <div className="mt-2.5 pt-2.5 border-t border-gray-200">
        <SectionLabel className="mb-1.5 text-slate-500">What this does not say</SectionLabel>
        <div className="border-l-2 border-slate-300 pl-2.5 space-y-1.5 text-[11px] leading-relaxed text-gray-500">
          <p>
            A chain is a sequence of{" "}
            <span className="font-medium text-gray-700">local moves</span>, each within{" "}
            {thresholdKm} km — not one commute. Four hops still add up.
          </p>
          <p>
            The <span className="font-medium text-gray-700">verdict</span> is nationwide, so it
            holds whatever you loaded. The{" "}
            <span className="font-medium text-gray-700">lines</span> can only join institutions
            you HAVE loaded — a node at the edge of your selection may have neighbours
            off-screen.
          </p>
          <p>
            TESDA matching is{" "}
            <span className="font-medium text-gray-700">role-based only</span> — it does not
            check that the centre assesses what was trained for, so tech-voc completeness is{" "}
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
