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

  // Fade IN on "Change area" re-entry, so the landing page doesn't pop abruptly over the
  // live map. But on the FIRST load (`instant`) appear immediately: there, fading in from
  // transparent revealed the empty map behind the overlay for a frame — the load "flash".
  const [entered, setEntered] = useState(instant);
  useEffect(() => {
    if (instant) return;
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, [instant]);
  const shown = entered && !fading;

  const scopeHint =
    selectedProvinces.length >= 2
      ? `Province-wide — all institutions across ${selectedProvinces.length} provinces`
      : selectedProvinces.length === 1
        ? selectedMunicipalities.length >= 1
          ? `Municipal view — ${selectedMunicipalities.length} municipality/ies`
          : "Whole province (all municipalities)"
        : "Pick at least one province";

  return (
    <div
      className={`absolute inset-0 z-20 flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 transition-opacity duration-300 ease-out ${
        shown ? "opacity-100" : "opacity-0"
      }`}
    >
      <div
        className={`w-full max-w-lg bg-white rounded-2xl shadow-xl border border-gray-100 p-7 m-4 max-h-[92vh] overflow-y-auto transition-all duration-300 ease-out ${
          shown ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-2 scale-[0.98]"
        }`}
      >
        <div className="mb-5">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-blue-600">Ugnay</span>
            <span className="text-sm text-gray-400">Educational Pathway Explorer</span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Choose an area and the education sectors you want to see, then explore the map.
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

        <button
          onClick={onExplore}
          disabled={!canExplore}
          className={`w-full rounded-lg py-2.5 text-sm font-semibold transition-all ${
            canExplore
              ? "bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
              : "bg-gray-100 text-gray-400 cursor-not-allowed"
          }`}
        >
          Explore map →
        </button>
        {!canExplore && (
          <p className="text-xs text-gray-400 text-center mt-2">
            Select an area and at least one sector to continue.
          </p>
        )}
      </div>
    </div>
  );
}
