import { useState } from "react";
import ShapeMark from "./ShapeMark";
import { PATHWAYS, STATUS_STYLE, VERDICTS, NEUTRAL_FILL } from "../lib/progression";
import { SECTOR_GROUPS, SECTOR_LABEL } from "../lib/graph";

// Legend for the network view. Same collapsible, bottom-anchored shell as the map's.
//
// Content is split into three tabs (Verdicts / Sectors / Notes) so the panel stays
// compact. Previously all three blocks were stacked, which made the panel taller than
// the viewport at smaller screen heights and buried the caveats below a scroll.

const VERDICT_BLURB = {
  cut: (km) => (
    <>
      <span className="font-medium">Cut:</span> no next step within {km} km, and no
      TESDA center reachable either.
    </>
  ),
  partial: (km) => (
    <>
      <span className="font-medium">Alternative pathway:</span> no higher-ed within {km} km,
      but a TESDA training center is reachable. Tech-voc is an option; college is not.
      Academic pathway only.
    </>
  ),
  deadend: (km, ends) => (
    <>
      <span className="font-medium">Dead-end:</span> there is a next step, but the path from
      here never reaches {ends}.{" "}
      <span className="text-gray-500">The map can't show you this.</span>
    </>
  ),
  complete: (km, ends) => (
    <>
      <span className="font-medium">Complete:</span> a learner can get all the way to {ends}.
    </>
  ),
};

// The key itself, without the floating shell. Reused as a tab in the mobile bottom sheet.
export function NetworkLegendBody({ sectorColors, nodeShapes, pathway, thresholdKm }) {
  const [tab, setTab] = useState("verdicts");
  const ends = PATHWAYS[pathway].ends;

  return (
    <div className="text-xs">
      <div className="flex rounded-md overflow-hidden border border-gray-200 mb-3">
        {[["verdicts", "Verdicts"], ["sectors", "Sectors"], ["notes", "Notes"]].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 py-1.5 text-[11px] font-medium transition-colors ${
              tab === key
                ? "bg-slate-800 text-white"
                : "bg-white text-gray-500 hover:bg-gray-50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "verdicts" && (
        <div className="space-y-2.5 text-gray-700">
          {VERDICTS.map((v) => (
            <div key={v} className="flex items-start gap-2.5">
              <span
                className="w-3 h-3 rounded-full shrink-0 mt-0.5"
                style={{
                  backgroundColor: `${STATUS_STYLE[v].color}33`,
                  boxShadow: `inset 0 0 0 1.5px ${STATUS_STYLE[v].color}`,
                }}
              />
              <span className="text-[11px] leading-snug">{VERDICT_BLURB[v](thresholdKm, ends)}</span>
            </div>
          ))}
          <p className="text-[10px] leading-relaxed text-gray-500 pt-1.5 border-t border-gray-100">
            Highlighting a verdict{" "}
            <span className="font-medium text-gray-700">dims the others</span> instead of hiding
            them, so you can see where the highlighted ones sit relative to everything else.
          </p>
        </div>
      )}

      {tab === "sectors" && (
        <div>
          <p className="text-[10px] text-gray-500 mb-2">Same colors and shapes as the map.</p>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
            {SECTOR_GROUPS.flatMap((g) => g.fills).map((k) => (
              <div key={k} className="flex items-center gap-2 text-[11px] text-gray-700">
                <ShapeMark shape={nodeShapes?.[k] || "circle"} color={sectorColors[k]} size={11} />
                <span className="truncate">{SECTOR_LABEL[k]}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-2.5 border-t border-gray-200">
            <div className="flex items-start gap-2.5 text-[11px] leading-relaxed text-gray-600">
              <span
                className="w-3 h-3 rounded-full shrink-0 mt-0.5"
                style={{ backgroundColor: NEUTRAL_FILL }}
              />
              <span>
                Everything starts gray on purpose. Turn on a sector above to see where each
                type sits in the graph.
              </span>
            </div>
          </div>
        </div>
      )}

      {tab === "notes" && (
        <div className="space-y-2 text-[11px] leading-relaxed text-gray-600">
          <p>
            <span className="font-medium text-gray-800">This isn't a map.</span> Institutions are
            pulled together by the pathways between them. Where a dot sits tells you how connected
            it is, not where it is. A school with nowhere to progress to drifts out to the edge.
          </p>
          <div className="border-l-2 border-slate-200 pl-2.5 space-y-2">
            <p>
              Each <span className="font-medium text-gray-700">step</span> has to be within{" "}
              {thresholdKm} km, but the steps add up. Four of them can still leave a learner a
              long way from home.
            </p>
            <p>
              The <span className="font-medium text-gray-700">verdict</span> is calculated across
              the whole country, so it's right no matter which area you loaded. The{" "}
              <span className="font-medium text-gray-700">lines</span> aren't: they can only
              connect institutions in your current selection, so a dot near the edge may have
              neighbors you can't see.
            </p>
            <p>
              Senior high schools draw edges to both HEI and TESDA centers because TESDA centers
              can deploy their programs to nearby Grade 12 students -- a school can only offer
              TESDA courses if a center is within reach. Those edges are always visible regardless
              of which pathway you have selected.
            </p>
            <p>
              We only check that a TESDA center{" "}
              <span className="font-medium text-gray-700">offers assessment</span>, not that it
              assesses the qualification the learner trained for. So the tech-voc numbers are{" "}
              <span className="font-medium text-gray-700">optimistic</span>.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function NetworkLegend(props) {
  const [open, setOpen] = useState(true);

  return (
    <div className="absolute bottom-3 left-3 z-20 flex flex-col justify-end pointer-events-none">
      {/* Width pinned in both states: the collapsed body still drives the box's intrinsic
          width, so a shrink-to-fit shell would size the "collapsed" pill to the widest line.
          (Same trap as the map legend.) */}
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
