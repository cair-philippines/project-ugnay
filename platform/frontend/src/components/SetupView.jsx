import { useEffect, useState } from "react";
import GeoPicker from "./GeoPicker";

const SECTOR_LAYERS = [
  {
    key: "basic",
    label: "Basic Education",
    sub: "DepEd public & private (ES · JHS · SHS)",
    dot: "bg-blue-500",
  },
  {
    key: "higher",
    label: "Higher Education",
    sub: "CHED HEIs",
    dot: "bg-green-500",
  },
  {
    key: "techvoc",
    label: "Technical–Vocational",
    sub: "TESDA providers & assessment centers",
    dot: "bg-purple-500",
  },
];


// Real figures from the pipeline manifest (output/nodes/_manifest.json). Stated because a
// planner's first question is "does this actually cover my area?" — and because a number
// you can check is worth more than an adjective you can't.
const COVERAGE = [
  { n: "47,607", label: "DepEd public" },
  { n: "8,257", label: "DepEd private" },
  { n: "2,431", label: "CHED HEIs" },
  { n: "7,891", label: "TESDA centers" },
];

// The preamble exists to answer, before the user touches anything: what IS this, what will
// it show me, and what must I not conclude from it. The last part matters as much as the
// first — this map is easy to over-read, and a planner who mistakes "reachable" for
// "attended" would draw the wrong conclusion from a perfectly correct map.
function Preamble({ compact = false }) {
  // `compact` is the phone variant. The desktop preamble can afford to breathe in its own
  // column; stacked on a 390px screen the SAME markup pushed "Choose what to map" and the
  // region picker clean below the fold — so every visit would begin by scrolling past a
  // wall of text to reach the one control you came for. Compact keeps every idea (lead,
  // the three verbs, coverage, the caveat) and simply spends less vertical space on each.
  const pad = compact ? "p-6" : "p-7 sm:p-9";
  const title = compact ? "text-2xl" : "text-3xl";
  const lead = compact ? "text-sm" : "text-[15px]";
  const body = compact ? "text-xs" : "text-[13px]";
  const gap = compact ? "space-y-2" : "space-y-2.5";

  return (
    <div
      className={`flex flex-col justify-center h-full ${pad} text-white bg-gradient-to-br from-slate-800 via-slate-800 to-blue-900`}
    >
      {/* Agency logos — white pill so the colored logo fills display correctly on dark */}
      <div className={`flex items-center gap-3 bg-white rounded-xl w-fit ${compact ? "mb-3 px-2.5 py-1.5" : "mb-4 px-3 py-2"}`}>
        <img
          src="/logos/deped.svg"
          alt="Department of Education"
          className={compact ? "h-6 w-auto" : "h-8 w-auto"}
        />
        <div className={`w-px self-stretch my-0.5 bg-gray-300`} />
        <img
          src="/logos/ecair.png"
          alt="Education Center for AI Research Philippines"
          className={compact ? "h-6 w-auto" : "h-8 w-auto"}
        />
      </div>

      <div className="flex items-baseline gap-2.5 flex-wrap">
        <span className={`${title} font-bold tracking-tight`}>Ugnay</span>
        <span className="text-xs sm:text-sm text-blue-200/70">Education Institutions Map</span>
      </div>

      <p className={`mt-3 ${lead} leading-relaxed text-blue-50`}>
        See where a learner can keep going, and{" "}
        <span className="font-semibold text-white">where the next step isn’t there.</span>
      </p>

      {!compact && (
        <p className="mt-3 text-[13px] leading-relaxed text-blue-100/70">
          Every school, university and training center in the country on one map. Seeing DepEd,
          CHED and TESDA together turns three separate inventories into one question you can
          act on: <span className="text-blue-50">where does a learner run out of options?</span>
        </p>
      )}

      {/* What you can actually DO. Three verbs, in the order you'd do them. */}
      <ul className={`mt-4 ${gap} ${body} text-blue-50/90`}>
        <li className="flex gap-2.5">
          <span className="text-blue-300 mt-px">→</span>
          <span>
            <span className="font-semibold text-white">Pick an area</span>: a region, a
            province, or a single city.
          </span>
        </li>
        <li className="flex gap-2.5">
          <span className="text-blue-300 mt-px">→</span>
          <span>
            <span className="font-semibold text-white">Tap an institution</span> to see what’s
            within reach <span className="whitespace-nowrap">by road</span> that offers
            something it doesn’t: the next grade level, a university, or a technical and
            vocational program.
          </span>
        </li>
        <li className="flex gap-2.5">
          <span className="text-blue-300 mt-px">→</span>
          <span>
            <span className="font-semibold text-white">Turn on Gap analysis</span> to surface
            where that next step is missing entirely.
          </span>
        </li>
        <li className="flex gap-2.5">
          <span className="text-blue-300 mt-px">→</span>
          <span>
            <span className="font-semibold text-white">Switch to Network</span> to see the
            full pathway as a graph: which chains of institutions can reach a university or
            assessment center, and which dead-end before they get there.
          </span>
        </li>
      </ul>

      {/* Coverage — the credibility line. A planner's first question is "does this cover my
          area?", and a number they can check beats an adjective they can't. */}
      <div className={`${compact ? "mt-4 pt-3" : "mt-6 pt-5"} border-t border-white/10`}>
        {compact ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {COVERAGE.map((c) => (
              <div key={c.label} className="flex items-baseline gap-1.5">
                <span className="text-sm font-semibold tabular-nums">{c.n}</span>
                <span className="text-[10px] text-blue-200/60">{c.label}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            {COVERAGE.map((c) => (
              <div key={c.label}>
                <div className="text-lg font-semibold tabular-nums leading-none">{c.n}</div>
                <div className="text-[11px] text-blue-200/60 mt-0.5">{c.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* The honest caveat, up front rather than buried in the legend. It is the one
            sentence that stops the map being misread. */}
        <p className={`${compact ? "mt-3" : "mt-5"} text-[11px] leading-relaxed text-blue-200/50`}>
          Distances are <span className="text-blue-100/80">road distances</span>, not straight
          lines. This map shows what’s{" "}
          <span className="text-blue-100/80">within reach</span>, not who actually enrolls.
        </p>
        <p className={`${compact ? "mt-2" : "mt-3"} text-[10px] text-blue-200/35`}>
          This platform is developed by the Education Center for AI Research.
        </p>
      </div>
    </div>
  );
}


export default function SetupView({
  adminIndex,
  isLoadingIndex,
  selectedRegion,
  selectedProvinces,
  selectedMunicipalities,
  activeSectors,
  onRegionChange,
  onProvinceToggle,
  onSelectAllProvinces,
  onClearProvinces,
  onMunicipalityToggle,
  onSectorToggle,
  onExplore,
  fading,
  instant = false,
}) {
  const hasArea = selectedRegion && selectedProvinces.length >= 1;
  const hasSector = activeSectors.size >= 1;
  const canExplore = hasArea && hasSector;

  // Two layers, deliberately out of step — this is what makes the entrance elegant WITHOUT
  // reintroducing the load flash:
  //
  //   BACKDROP — opaque from the very first painted frame on first load (`instant`). It's
  //              the only thing standing between the user and the empty map, so it must
  //              never be transparent; fading it in is exactly what caused the flash.
  //   CARD     — always fades and rises in, first load included. It has the backdrop behind
  //              it, so there is nothing to see through it.
  //
  // On "Change area" re-entry the backdrop fades too, since it's arriving over a live map
  // and popping would be jarring.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const shown = entered && !fading;
  const backdropShown = (instant || entered) && !fading;

  // The hint tracks where the user actually IS. Before a region is chosen there are no
  // provinces to pick, so "Pick at least one province" was telling them to do something
  // they couldn't yet do; the first instruction has to be the first action.
  const scopeHint = !selectedRegion
    ? "Pick a region"
    : selectedProvinces.length >= 2
      ? `Province-wide: all institutions across ${selectedProvinces.length} provinces`
      : selectedProvinces.length === 1
        ? selectedMunicipalities.length >= 1
          ? `Municipal view: ${selectedMunicipalities.length} municipality/ies`
          : "Whole province (all municipalities)"
        : "Pick at least one province";

  return (
    <div
      className={`absolute inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 transition-opacity duration-300 ease-out ${
        backdropShown ? "opacity-100" : "opacity-0"
      }`}
    >
      {/* TWO COLUMNS on desktop — the preamble (what this is, and what it isn't) on the
          left, the controls on the right; STACKED on mobile, preamble first. The split is
          not decoration: the left column answers "should I trust this and what will it show
          me?", which a user needs settled BEFORE they are asked to make choices on the right.

          Each column scrolls independently, and the Explore button sits in a pinned footer
          under the right column, so the primary action is never something you have to go
          hunting for. */}
      <div
        // `md:grid-rows-[minmax(0,1fr)]` is load-bearing. A grid row is sized to its CONTENT
        // by default, so with a long province + municipality list the right column grew past
        // the card's max-height — and since the card is `overflow-hidden`, the pinned footer
        // (and with it "Explore map →") was simply clipped away off the bottom of the card.
        // Constraining the row to the card's height is what lets the columns scroll INSIDE it.
        className={`w-full max-w-4xl bg-white rounded-2xl shadow-2xl border border-gray-100 m-4 max-h-[92dvh]
          flex flex-col md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] md:grid-rows-[minmax(0,1fr)]
          overflow-hidden transition-all duration-500 ease-out ${
            shown ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-3 scale-[0.98]"
          }`}
      >
      {/* DESKTOP: the preamble is its own column, scrolling independently.
          Exactly one of the two Preambles is ever DISPLAYED (`hidden` is display:none, so
          the other is out of the a11y tree too) — the mobile copy has to live inside the
          scroll container with the controls, and the desktop copy has to live in its own
          grid column, and those are genuinely different places in the tree. */}
      <div className="hidden md:block md:min-h-0 md:overflow-y-auto overscroll-contain">
        <Preamble />
      </div>

      {/* RIGHT (desktop) / EVERYTHING (mobile) — the choices. */}
      <div className="flex flex-col min-h-0 flex-1 overflow-hidden">
      <div className="overflow-y-auto overscroll-contain flex-1">
      {/* MOBILE: the preamble scrolls WITH the controls, as one continuous read. A separate
          scrolling box for it would be a nested scroll trap, and stacking it as a fixed row
          would push the Explore button off the bottom of the screen — which is exactly the
          bug this layout has to avoid. */}
      <div className="md:hidden">
        <Preamble compact />
      </div>
      <div className="px-6 sm:px-7 pt-6 sm:pt-7 pb-2">
        <div className="mb-5">
          <div className="text-sm font-semibold text-gray-800">Choose what to map</div>
          <p className="text-xs text-gray-500 mt-1">
            Pick an area and the sectors you want to see.
          </p>
        </div>

        {/* Step 1 — area */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-bold">
              1
            </span>
            <span className="text-sm font-semibold text-gray-700">Area</span>
            <span className="ml-auto text-xs text-gray-400">{scopeHint}</span>
          </div>
          {isLoadingIndex ? (
            <p className="text-sm text-gray-400">Loading regions…</p>
          ) : (
            <GeoPicker
              adminIndex={adminIndex}
              selectedRegion={selectedRegion}
              selectedProvinces={selectedProvinces}
              selectedMunicipalities={selectedMunicipalities}
              onRegionChange={onRegionChange}
              onProvinceToggle={onProvinceToggle}
              onSelectAllProvinces={onSelectAllProvinces}
              onClearProvinces={onClearProvinces}
              onMunicipalityToggle={onMunicipalityToggle}
            />
          )}
        </div>

        {/* Step 2 — sectors */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-bold">
              2
            </span>
            <span className="text-sm font-semibold text-gray-700">Education sectors</span>
          </div>
          <div className="space-y-2">
            {SECTOR_LAYERS.map((s) => {
              const on = activeSectors.has(s.key);
              return (
                <button
                  key={s.key}
                  onClick={() => onSectorToggle(s.key)}
                  className={`w-full flex items-center gap-3 text-left rounded-lg border px-3 py-2 transition-all ${
                    on
                      ? "border-blue-400 bg-blue-50/60 ring-1 ring-blue-200"
                      : "border-gray-200 bg-white hover:border-gray-300"
                  }`}
                >
                  <span className={`w-3 h-3 rounded-full shrink-0 ${s.dot} ${on ? "" : "opacity-30"}`} />
                  <span className="flex-1">
                    <span className={`block text-sm font-medium ${on ? "text-gray-800" : "text-gray-500"}`}>
                      {s.label}
                    </span>
                    <span className="block text-xs text-gray-400">{s.sub}</span>
                  </span>
                  <span
                    className={`text-xs rounded-full px-2 py-0.5 ${
                      on ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-400"
                    }`}
                  >
                    {on ? "On" : "Off"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

      </div>
      </div>

      {/* Pinned footer — always on screen, whatever the list above is doing. */}
      <div className="shrink-0 px-6 sm:px-7 pt-3 pb-6 sm:pb-7 border-t border-gray-100 bg-white">
        <button
          onClick={onExplore}
          disabled={!canExplore}
          className={`w-full rounded-lg py-3 sm:py-2.5 text-sm font-semibold transition-all ${
            canExplore
              ? "bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
              : "bg-gray-100 text-gray-400 cursor-not-allowed"
          }`}
        >
          Explore map →
        </button>
        {!canExplore && (
          <p className="text-xs text-gray-400 text-center mt-2">
            {!selectedRegion
              ? "Choose a region to begin."
              : "Select an area and at least one sector to continue."}
          </p>
        )}
      </div>
      </div>
      </div>
    </div>
  );
}
