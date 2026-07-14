import { useState } from "react";
import { LegendBody } from "./Legend";
import { NetworkLegendBody } from "./NetworkLegend";
import ShapeMark from "./ShapeMark";
import { NODE_SHAPES, SHAPE_LABEL } from "../lib/nodeShapes";
import { SECTOR_GROUPS, SECTOR_LABEL } from "../lib/graph";
import { STATUS_STYLE, VERDICTS } from "../lib/progression";

// The map's control surface. Same content in two very different shells:
//
//   DESKTOP — a floating panel, top-right, collapsible. Two tabs so data controls and
//             visual controls don't fight for space:
//               Filters    — WHAT you see: sector subcategories, accessibility threshold
//               Appearance — HOW it looks: node size/shape/colour, border thickness
//
//   MOBILE  — a bottom SHEET, collapsed to a handle so the map is unobstructed by default.
//             It also absorbs the controls that live in the header on desktop (sector
//             toggles, gap analysis, basemap) and the Legend, as a third tab. A phone has
//             no room for a top bar of buttons AND two floating panels: consolidating them
//             into one sheet is what makes the map actually readable at 390px.

const SUBCATS = {
  basic: {
    title: "Basic Education",
    dot: "bg-blue-500",
    items: [
      { key: "es", label: "Elementary (ES)" },
      { key: "jhs", label: "Junior High (JHS)" },
      { key: "shs", label: "Senior High (SHS)" },
    ],
  },
  higher: {
    title: "Higher Education",
    dot: "bg-green-500",
    items: [
      { key: "public", label: "Public (SUC / LUC)" },
      { key: "private", label: "Private" },
    ],
  },
  techvoc: {
    title: "Technical–Vocational",
    dot: "bg-purple-500",
    items: [
      { key: "training", label: "Training provider" },
      { key: "assessment", label: "Assessment center" },
    ],
  },
};

const SECTOR_KEYS = ["basic", "higher", "techvoc"];

const SECTOR_SWATCHES = [
  ["public", "DepEd Public"],
  ["private", "DepEd Private"],
  ["hei_public", "Higher Ed — Public"],
  ["hei_private", "Higher Ed — Private"],
  ["tesda", "TESDA"],
];

const HEADER_SECTORS = [
  ["basic", "Basic", "bg-blue-500"],
  ["higher", "Higher", "bg-green-500"],
  ["techvoc", "Tech-Voc", "bg-purple-500"],
];

function Swatch({ color, onChange }) {
  return (
    <input
      type="color"
      value={color}
      onChange={(e) => onChange(e.target.value)}
      className="w-6 h-6 rounded border border-gray-200 cursor-pointer p-0 bg-transparent shrink-0"
      title="Pick color"
    />
  );
}

// Shape picker: the four marks laid out as a row of toggles rather than a <select>, so the
// choice is made by looking at the shape itself instead of reading its name.
function ShapePicker({ value, color, onChange }) {
  return (
    <div className="flex items-center gap-0.5 shrink-0">
      {NODE_SHAPES.map((s) => {
        const on = value === s;
        return (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            title={SHAPE_LABEL[s]}
            aria-pressed={on}
            className={`w-6 h-6 flex items-center justify-center rounded border transition-colors ${
              on
                ? "border-blue-500 bg-blue-50"
                : "border-transparent hover:border-gray-200 hover:bg-gray-50"
            }`}
          >
            <ShapeMark shape={s} color={on ? color : "#9CA3AF"} size={12} />
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- network filters
//
// The network view's controls are a different KIND of thing to the map's, and they are kept
// visibly different so nobody mistakes one for the other. The map's filters decide what
// EXISTS on screen. These decide what you are ASKING — the graph is fully drawn either way,
// in grey, and a filter is how you interrogate it. Everything here starts OFF, on purpose:
// an unasked question should not be answered.

function VerdictFilter({ netVerdicts, onToggleVerdict, thresholdKm, pathwayEnds }) {
  const HINT = {
    cut: `no next step within ${thresholdKm} km`,
    deadend: `has a next step, but never reaches ${pathwayEnds}`,
    complete: `the chain closes`,
  };
  return (
    <div>
      <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
        Highlight by verdict
      </div>
      <div className="space-y-1">
        {VERDICTS.map((v) => {
          const on = netVerdicts.has(v);
          const col = STATUS_STYLE[v].color;
          return (
            <button
              key={v}
              onClick={() => onToggleVerdict(v)}
              aria-pressed={on}
              // One line, not two. The definitions live in the legend and on the hover title;
              // repeating them here as sub-captions pushed the panel down onto the readout in
              // the bottom-right corner and left the two boxes fighting for the same pixels.
              title={HINT[v]}
              className={`w-full flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-all ${
                on ? "" : "border-gray-200 bg-white hover:bg-gray-50"
              }`}
              style={on ? { backgroundColor: `${col}14`, borderColor: `${col}66` } : undefined}
            >
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{
                  backgroundColor: on ? col : "transparent",
                  boxShadow: `inset 0 0 0 1.5px ${col}`,
                }}
              />
              <span
                className={`text-xs truncate ${
                  on ? "font-semibold text-gray-800" : "text-gray-600"
                }`}
              >
                {STATUS_STYLE[v].label}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-gray-400 leading-snug mt-1.5">
        Lights the matching institutions and fades the rest back — it does not remove them.
      </p>
    </div>
  );
}

function SectorColourFilter({ netFills, onToggleFill, onToggleGroup, sectorColors, nodeShapes }) {
  return (
    <div>
      <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
        Colour by sector
      </div>
      <div className="space-y-2">
        {SECTOR_GROUPS.map((g) => {
          const all = g.fills.every((f) => netFills.has(f));
          const some = g.fills.some((f) => netFills.has(f));
          return (
            <div key={g.key}>
              <button
                onClick={() => onToggleGroup(g.key, !all)}
                className="w-full flex items-center gap-2 text-xs text-left group"
              >
                <span
                  className={`w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center text-[9px] leading-none shrink-0 transition-colors ${
                    all
                      ? "bg-gray-800 border-gray-800 text-white"
                      : some
                        ? "bg-gray-300 border-gray-400 text-white"
                        : "bg-white border-gray-300 text-transparent group-hover:border-gray-500"
                  }`}
                >
                  {all ? "✓" : some ? "–" : "✓"}
                </span>
                <span
                  className={`font-semibold ${some ? "text-gray-700" : "text-gray-500"}`}
                >
                  {g.title}
                </span>
              </button>
              <div className="pl-5 mt-0.5 space-y-0.5">
                {g.fills.map((f) => {
                  const on = netFills.has(f);
                  return (
                    <label
                      key={f}
                      className="flex items-center gap-2 text-[11px] cursor-pointer rounded px-1 py-0.5 hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => onToggleFill(f)}
                        className="accent-blue-500 shrink-0"
                      />
                      <ShapeMark
                        shape={nodeShapes?.[f] || "circle"}
                        color={on ? sectorColors[f] : "#CBD5E1"}
                        size={10}
                      />
                      <span className={`truncate ${on ? "text-gray-700" : "text-gray-400"}`}>
                        {SECTOR_LABEL[f]}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-gray-400 leading-snug mt-1.5">
        Same colours as the map. Sectors you haven’t picked stay grey — they are still there,
        still holding the graph together.
      </p>
    </div>
  );
}

function Slider({ label, value, unit, min, max, step = 1, onChange, ticks }) {
  return (
    <div>
      <label className="flex items-center justify-between text-xs text-gray-600 mb-1">
        <span>{label}</span>
        <span className="font-semibold text-gray-700">
          {value}
          {unit}
        </span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-blue-500"
      />
      {ticks && (
        <div className="flex justify-between text-[10px] text-gray-400 px-0.5">
          {ticks.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FilterPanel({
  drawerOpen,
  activeSectors,
  subcats,
  onSubcatToggle,
  dimmed,
  onDimToggle,
  thresholdKm,
  onThreshold,
  nodeSize,
  onNodeSize,
  borderWidth,
  onBorderWidth,
  sectorColors,
  onSectorColor,
  nodeShapes,
  onSectorShape,
  colorblind,
  onColorblindToggle,
  // mobile-only: the header's controls move in here
  isMobile = false,
  onSectorToggle,
  gapVisible,
  onGapToggle,
  basemap,
  onBasemap,
  uiHidden = false,
  // Which view is active. The Legend tab has to show the legend for the thing you are
  // actually looking at — the two views use DIFFERENT grammars (on the map, fill is the
  // sector; in the network, fill is the verdict), so showing the map's key over a network
  // graph would not be merely unhelpful, it would be wrong.
  view = "map",
  pathway,
  pathwayEnds,
  showReskilling,
  onToggleReskilling,
  // Network-only. Both start EMPTY — see VerdictFilter/SectorColourFilter above.
  netFills,
  netVerdicts,
  onToggleFill,
  onToggleFillGroup,
  onToggleVerdict,
}) {
  const isNetwork = view === "network";
  // The sheet starts CLOSED on mobile (the whole point is an unobstructed map); the
  // desktop panel starts open, where there's room for it.
  const [open, setOpen] = useState(!isMobile);
  const [tab, setTab] = useState("filters");
  const shownSectors = SECTOR_KEYS.filter((k) => activeSectors.has(k));

  const tabs = isMobile
    ? [["filters", "Filters"], ["appearance", "Appearance"], ["legend", "Legend"]]
    : [["filters", "Filters"], ["appearance", "Appearance"]];

  // --- shell -----------------------------------------------------------------
  // Desktop: floating card that steps out of the detail drawer's way (a transform, in step
  // with the drawer's own slide) rather than sitting underneath it.
  // Mobile: full-width sheet pinned to the bottom edge. It does NOT shift — the mobile
  // detail view is itself a bottom sheet and simply covers it.
  //
  // "Clear map" mode slides the panel out to the edge it lives on — right on desktop, down
  // on mobile — rather than deleting it. The map is being *revealed*, not cleared, and the
  // exit shows you where the panel went, so bringing it back reads as reversible.
  // `top-14` (not `top-3`): the header is now an overlay, so the panel must clear it.
  const exit = isMobile
    ? "translate-y-full opacity-0 pointer-events-none"
    : "translate-x-[calc(100%+1.5rem)] opacity-0 pointer-events-none";

  const shell = isMobile
    ? `ugnay-sheet absolute inset-x-0 bottom-0 z-20 rounded-t-2xl border-t transition-[transform,opacity] duration-300 ease-out ${
        uiHidden ? exit : ""
      }`
    // z-20, NOT z-10. The network view is a full-bleed `absolute inset-0 z-10` overlay that
    // comes LATER in the DOM, so at an equal z-index it wins — and its canvas was quietly
    // covering this whole panel. Everything still looked right (the panel paints on top only
    // by accident of stacking), but nothing in it could be clicked in the network view: the
    // threshold slider, which drives both the edges AND the verdicts, was dead. Anything that
    // must stay usable over the network sits at z-20 or above (legend, readout, drawer).
    : `absolute top-14 right-3 z-20 w-64 rounded-xl border transition-[transform,opacity] duration-300 ease-out ${
        uiHidden ? exit : drawerOpen ? "-translate-x-72" : ""
      }`;

  // Body height: on mobile cap the sheet at 70vh so the map is never fully swallowed.
  //
  // On desktop the NETWORK gets a tighter cap, because the bottom-right corner is not empty
  // there: the verdict readout lives in it. At the map's budget the panel grew all the way
  // down onto the readout and the two boxes met with no gap at all — legible, but it read as
  // a rendering bug. Shorter cap, panel scrolls, corner stays clear.
  const bodyOpen = isMobile
    ? "max-h-[70dvh] opacity-100"
    : isNetwork
      ? "max-h-[calc(100vh-21rem)] opacity-100"
      : "max-h-[calc(100vh-14rem)] opacity-100";
  const scrollCap = isMobile
    ? "max-h-[calc(70dvh-6rem)]"
    : isNetwork
      ? "max-h-[calc(100vh-24rem)]"
      : "max-h-[calc(100vh-17rem)]";

  return (
    <div
      aria-hidden={uiHidden}
      inert={uiHidden}
      className={`bg-white/95 backdrop-blur shadow-lg border-gray-100 text-sm overflow-hidden flex flex-col ${shell}`}
    >
      {/* The header doubles as the collapse toggle, and the BODY rolls open/shut
          (max-height + opacity) rather than the panel swapping to a different pill — so it
          animates smoothly, matching the Legend instead of popping. On mobile it's a sheet
          handle: a grab bar, a big tap target, and the same roll. */}
      <button
        onClick={() => setOpen((o) => !o)}
        title={open ? "Collapse panel" : "Show layers & filters"}
        className={`w-full text-left hover:bg-gray-50 transition-colors shrink-0 ${
          isMobile ? "flex flex-col items-center gap-1 pt-2 pb-2.5 px-3" : "flex items-center justify-between gap-2 px-3 py-2"
        }`}
      >
        {isMobile && <span className="w-9 h-1 rounded-full bg-gray-300 shrink-0" />}
        <span className={isMobile ? "flex items-center justify-between w-full" : "contents"}>
          <span className="font-semibold text-gray-700 text-xs uppercase tracking-wide flex items-center gap-1.5">
            <span className="text-gray-400">☰</span> Layers &amp; Filters
          </span>
          <span
            className={`text-gray-400 leading-none transition-transform duration-300 ${
              open ? "rotate-180" : ""
            }`}
          >
            ⌄
          </span>
        </span>
      </button>

      {/* Collapsible body — rolls open/shut like the Legend. */}
      <div
        aria-hidden={!open}
        inert={!open}
        className={`transition-all duration-300 ease-out overflow-hidden border-t border-gray-100 ${
          open ? bodyOpen : "max-h-0 opacity-0"
        }`}
      >
        {/* Tabs */}
        <div className="flex border-b border-gray-100 shrink-0">
          {tabs.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`flex-1 font-medium transition-colors ${
                isMobile ? "text-sm py-2.5" : "text-xs py-1.5"
              } ${
                tab === k
                  ? "text-blue-600 border-b-2 border-blue-500 -mb-px"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className={`overflow-y-auto overscroll-contain ${scrollCap}`}>
          {tab === "filters" && (
            <>
              {/* NETWORK: an entirely different filter surface. The map's sector toggles
                  decide what EXISTS; these decide what you are ASKING of a graph that is
                  already fully drawn. Mixing the two sets in one panel would be the fastest
                  way to make people think a grey node had been filtered out. */}
              {isNetwork && (
                <div className="px-3 py-2.5 space-y-3">
                  <VerdictFilter
                    netVerdicts={netVerdicts}
                    onToggleVerdict={onToggleVerdict}
                    thresholdKm={thresholdKm}
                    pathwayEnds={pathwayEnds}
                  />
                  <div className="pt-3 border-t border-gray-100">
                    <SectorColourFilter
                      netFills={netFills}
                      onToggleFill={onToggleFill}
                      onToggleGroup={onToggleFillGroup}
                      sectorColors={sectorColors}
                      nodeShapes={nodeShapes}
                    />
                  </div>
                  <div className="pt-3 border-t border-gray-100">
                    <label className="flex items-start gap-2 text-[11px] text-gray-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showReskilling}
                        onChange={onToggleReskilling}
                        className="accent-purple-500 mt-0.5 shrink-0"
                      />
                      <span>
                        Show higher-ed → TESDA reskilling links
                        <span className="block text-[10px] text-gray-400 leading-snug">
                          Drawn dashed. They never complete a pathway.
                        </span>
                      </span>
                    </label>
                  </div>
                </div>
              )}

              {/* MOBILE ONLY: the controls that live in the desktop header. They're map
                  controls, so on a phone they belong with the other map controls rather
                  than in a top bar that can't fit them.
                  A basemap and a gap halo are MAP ideas — in a force layout there is no
                  terrain to put underneath and no pin to ring — and the sector toggles here
                  govern what the MAP shows, which the network deliberately ignores (it always
                  graphs the whole area, or the structure would be a lie). So on the network
                  the whole block leaves, rather than sitting there doing nothing. */}
              {isMobile && !isNetwork && (
                <div className="px-3 py-2.5 space-y-2.5 border-b border-gray-100 bg-gray-50/60">
                  <div>
                    <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                      Sectors
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {HEADER_SECTORS.map(([key, label, dot]) => {
                        const on = activeSectors.has(key);
                        return (
                          <button
                            key={key}
                            onClick={() => onSectorToggle(key)}
                            className={`flex items-center gap-1.5 text-xs rounded-full px-3 py-1.5 border transition-all ${
                              on
                                ? "bg-gray-800 text-white border-transparent"
                                : "bg-white text-gray-400 border-gray-200"
                            }`}
                          >
                            <span className={`w-2 h-2 rounded-full ${dot} ${on ? "" : "opacity-40"}`} />
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide w-16 shrink-0">
                      Basemap
                    </span>
                    <div className="flex items-center rounded-md border border-gray-200 overflow-hidden">
                      {["plain", "satellite", "roads"].map((b) => (
                        <button
                          key={b}
                          onClick={() => onBasemap(b)}
                          className={`text-xs px-3 py-1.5 capitalize transition-all ${
                            basemap === b ? "bg-gray-800 text-white" : "bg-white text-gray-500"
                          }`}
                        >
                          {b}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={onGapToggle}
                    className={`w-full text-xs rounded-md px-3 py-2 border transition-all text-left flex items-center justify-between ${
                      gapVisible
                        ? "bg-amber-500 text-white border-transparent"
                        : "bg-white text-gray-600 border-gray-300"
                    }`}
                  >
                    Gap analysis
                    <span
                      className={`text-[10px] font-semibold uppercase ${
                        gapVisible ? "text-white/80" : "text-gray-400"
                      }`}
                    >
                      {gapVisible ? "On" : "Off"}
                    </span>
                  </button>
                </div>
              )}

              <div className={`px-3 py-2 space-y-3 ${isNetwork ? "hidden" : ""}`}>
                {shownSectors.length === 0 && (
                  <p className="text-xs text-gray-400 italic">
                    No sectors active. Turn one on {isMobile ? "above" : "in the top bar"}.
                  </p>
                )}
                {shownSectors.map((sk) => {
                  const def = SUBCATS[sk];
                  const on = subcats[sk];
                  return (
                    <div key={sk}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`w-2.5 h-2.5 rounded-full ${def.dot}`} />
                        <span className="text-xs font-semibold text-gray-600">{def.title}</span>
                      </div>
                      <div className="space-y-0.5 pl-1">
                        {def.items.map((it) => {
                          const visible = on.has(it.key);
                          const isDim = dimmed[sk].has(it.key);
                          return (
                            <div
                              key={it.key}
                              className={`flex items-center gap-2 text-xs rounded px-1 hover:bg-gray-50 ${
                                isMobile ? "py-1.5" : "py-0.5"
                              }`}
                            >
                              <label className="flex items-center gap-2 flex-1 cursor-pointer min-w-0">
                                <input
                                  type="checkbox"
                                  checked={visible}
                                  onChange={() => onSubcatToggle(sk, it.key)}
                                  className="accent-blue-500 shrink-0"
                                />
                                <span className="truncate">{it.label}</span>
                              </label>
                              <button
                                onClick={() => onDimToggle(sk, it.key)}
                                disabled={!visible}
                                title={isDim ? "Restore full opacity" : "Fade (keep visible)"}
                                className={`shrink-0 w-5 h-5 rounded flex items-center justify-center text-[11px] leading-none transition-colors ${
                                  !visible
                                    ? "text-gray-200 cursor-not-allowed"
                                    : isDim
                                      ? "bg-slate-700 text-white"
                                      : "text-gray-300 hover:text-gray-600 hover:bg-gray-100"
                                }`}
                              >
                                ◐
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* The threshold governs the edges, the gap halos AND the chain verdicts —
                  it's a data control, not a cosmetic one, so it lives with the filters and
                  stays in BOTH views. */}
              <div className="px-3 py-2 border-t border-gray-100">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Accessibility
                </div>
                <Slider
                  label="Road distance threshold"
                  value={thresholdKm}
                  unit=" km"
                  min={1}
                  max={5}
                  onChange={onThreshold}
                  ticks={[1, 2, 3, 4, 5]}
                />
                <p className="text-[10px] text-gray-400 leading-snug mt-1">
                  {isNetwork ? (
                    <>
                      One hop of the chain. Every edge in the graph — and every verdict — is
                      re-drawn at this <span className="font-semibold">road distance</span>.
                    </>
                  ) : (
                    <>
                      {isMobile ? "Tap" : "Click"} an institution to see everything within this{" "}
                      <span className="font-semibold">road distance</span> that offers something
                      it doesn’t.
                    </>
                  )}
                </p>
              </div>
            </>
          )}

          {tab === "appearance" && (
            <div className="px-3 py-2 space-y-3">
              {/* Continuous (0.25 px steps): node radius feeds the icon size, which takes
                  fractional values, so fine control is free. */}
              <Slider
                label="Node size"
                value={nodeSize}
                unit="px"
                min={2}
                max={9}
                step={0.25}
                onChange={onNodeSize}
              />

              <Slider
                label="Border thickness"
                value={borderWidth}
                unit="px"
                min={0}
                max={5}
                step={0.5}
                onChange={onBorderWidth}
              />
              <p className="text-[10px] text-gray-400 leading-snug -mt-1">
                Administrative borders. Set to 0 to hide them.
              </p>

              <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={colorblind}
                  onChange={onColorblindToggle}
                  className="accent-blue-500"
                />
                Colorblind-safe palette
              </label>

              <div>
                <div className="text-xs text-gray-500 mb-1">Sector colour &amp; shape</div>
                <p className="text-[10px] text-gray-400 leading-snug mb-1.5">
                  Shape is a second channel: it survives printing in black and white, and stays
                  readable where two sectors sit on top of each other.
                </p>
                {/* Two rows per sector, not one. On one row the swatch + label + four
                    shape toggles need ~280px, and the panel is 256 — so "Higher Ed —
                    Public" truncated to "Higher Ed — P…". The name of the sector is the
                    one thing here that must never be guessed at. */}
                <div className="space-y-2.5">
                  {SECTOR_SWATCHES.map(([k, label]) => (
                    <div key={k} className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 text-xs text-gray-700">
                        <Swatch color={sectorColors[k]} onChange={(c) => onSectorColor(k, c)} />
                        <span className="font-medium">{label}</span>
                      </div>
                      <div className="pl-8">
                        <ShapePicker
                          value={nodeShapes[k]}
                          color={sectorColors[k]}
                          onChange={(s) => onSectorShape(k, s)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* MOBILE ONLY: the legend is a tab here rather than a second floating panel —
              and it is the legend for whichever view you are in. */}
          {tab === "legend" && (
            <div className="px-3 py-2.5">
              {isNetwork ? (
                <NetworkLegendBody
                  sectorColors={sectorColors}
                  nodeShapes={nodeShapes}
                  pathway={pathway}
                  thresholdKm={thresholdKm}
                />
              ) : (
                <LegendBody
                  sectorColors={sectorColors}
                  nodeShapes={nodeShapes}
                  gapVisible={gapVisible}
                  thresholdKm={thresholdKm}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
