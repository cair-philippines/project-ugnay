import { useState } from "react";

// Top-right floating panel. Two tabs so data controls and visual controls don't fight
// for the same space, and collapsible because an always-open panel reached down over
// the map's zoom +/- buttons.
//
//   Filters    — WHAT you see: sector subcategories, accessibility threshold
//   Appearance — HOW it looks: node size, sector colours, border thickness

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

function Swatch({ color, onChange }) {
  return (
    <input
      type="color"
      value={color}
      onChange={(e) => onChange(e.target.value)}
      className="w-6 h-6 rounded border border-gray-200 cursor-pointer p-0 bg-transparent"
      title="Pick color"
    />
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
  colorblind,
  onColorblindToggle,
}) {
  const [open, setOpen] = useState(true); // expanded by default
  const [tab, setTab] = useState("filters");
  const shownSectors = SECTOR_KEYS.filter((k) => activeSectors.has(k));

  // The detail drawer overlays the right 18rem of the map. Step out of its way rather than
  // sit underneath it — a transform, in step with the drawer's own slide.
  const shift = `transition-transform duration-300 ease-out ${drawerOpen ? "-translate-x-72" : ""}`;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`absolute top-3 right-3 z-10 flex items-center gap-1.5 bg-white/95 backdrop-blur rounded-lg shadow-lg border border-gray-100 px-2.5 py-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900 hover:shadow-xl ${shift}`}
        title="Show layers & filters"
      >
        <span className="text-gray-400">☰</span> Layers
      </button>
    );
  }

  return (
    <div
      className={`absolute top-3 right-3 z-10 w-64 bg-white/95 backdrop-blur rounded-xl shadow-lg border border-gray-100 text-sm max-h-[calc(100vh-11rem)] flex flex-col ${shift}`}
    >
      {/* Header + collapse */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 shrink-0">
        <div className="font-semibold text-gray-700 text-xs uppercase tracking-wide">
          Layers &amp; Filters
        </div>
        <button
          onClick={() => setOpen(false)}
          className="text-gray-400 hover:text-gray-700 leading-none px-1"
          title="Collapse panel"
        >
          ⌄
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-100 shrink-0">
        {[
          ["filters", "Filters"],
          ["appearance", "Appearance"],
        ].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex-1 text-xs py-1.5 font-medium transition-colors ${
              tab === k
                ? "text-blue-600 border-b-2 border-blue-500 -mb-px"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-y-auto">
        {tab === "filters" && (
          <>
            <div className="px-3 py-2 space-y-3">
              {shownSectors.length === 0 && (
                <p className="text-xs text-gray-400 italic">
                  No sectors active. Turn one on in the top bar.
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
                            className="flex items-center gap-2 text-xs rounded px-1 py-0.5 hover:bg-gray-50"
                          >
                            <label className="flex items-center gap-2 flex-1 cursor-pointer min-w-0">
                              <input
                                type="checkbox"
                                checked={visible}
                                onChange={() => onSubcatToggle(sk, it.key)}
                                className="accent-blue-500 shrink-0"
                              />
                              <span
                                className={`truncate transition-opacity ${
                                  !visible
                                    ? "text-gray-300"
                                    : isDim
                                      ? "text-gray-400"
                                      : "text-gray-600"
                                }`}
                              >
                                {it.label}
                              </span>
                            </label>
                            {/* Fade, don't hide: pushes this level back so another can be
                                highlighted, while keeping it on screen as context. */}
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

            {/* The threshold governs BOTH the edges and the gap halos — it's a data
                control, not a cosmetic one, so it lives with the filters. */}
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
                Click an institution to see everything within this{" "}
                <span className="font-semibold">road distance</span> that offers something it
                doesn’t.
              </p>
            </div>
          </>
        )}

        {tab === "appearance" && (
          <div className="px-3 py-2 space-y-3">
            <Slider label="Node size" value={nodeSize} unit="px" min={2} max={9} onChange={onNodeSize} />

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
              <div className="text-xs text-gray-500 mb-1">Sector colors</div>
              <div className="space-y-1">
                {SECTOR_SWATCHES.map(([k, label]) => (
                  <div key={k} className="flex items-center gap-2 text-xs text-gray-600">
                    <Swatch color={sectorColors[k]} onChange={(c) => onSectorColor(k, c)} />
                    {label}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
