import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTiles } from "./hooks/useTiles";
import { useBoundaries } from "./hooks/useBoundaries";
import { collectNodes, buildAccessIndex, buildNearestIndex } from "./lib/graph";
import { accessibilityStats } from "./lib/stats";
import SetupView from "./components/SetupView";
import MapView from "./components/MapView";
import FilterPanel from "./components/FilterPanel";
import DetailDrawer from "./components/DetailDrawer";
import Legend from "./components/Legend";
import ErrorBoundary from "./components/ErrorBoundary";
// NOTE: ContinuityPanel (right sidebar) is deactivated for now — lower priority
// than edges + progression. The component file is kept for later.
// import ContinuityPanel from "./components/ContinuityPanel";

const BASEMAPS = {
  plain: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  roads: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
  satellite: {
    version: 8,
    sources: {
      sat: {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        attribution: "Esri World Imagery",
      },
    },
    layers: [{ id: "sat", type: "raster", source: "sat" }],
  },
};

// Higher-ed is split public/private (planners care where each sits) but kept in one hue
// family, so the sector still reads at a glance.
const DEFAULT_COLORS = {
  public: "#3B82F6",
  private: "#F97316",
  hei_public: "#10B981",
  hei_private: "#84CC16",
  tesda: "#A855F7",
};
// Okabe–Ito colorblind-safe palette
const CB_COLORS = {
  public: "#0072B2",
  private: "#E69F00",
  hei_public: "#009E73",
  hei_private: "#56B4E9",
  tesda: "#CC79A7",
};

const DEFAULT_SUBCATS = () => ({
  basic: new Set(["es", "jhs", "shs"]),
  higher: new Set(["public", "private"]),
  techvoc: new Set(["training", "assessment"]),
});

// De-emphasised (faded, but still on the map) subcategories — nothing dimmed by default.
const DEFAULT_DIMMED = () => ({ basic: new Set(), higher: new Set(), techvoc: new Set() });

function provincesOf(adminIndex, regionName) {
  const r = adminIndex?.regions.find((x) => x.region === regionName);
  return r ? r.provinces : [];
}

export default function App() {
  const {
    adminIndex,
    loadedTiles,
    isLoadingIndex,
    isLoadingTile,
    loadAdminIndex,
    loadTile,
    evictAll,
  } = useTiles();

  const [phase, setPhase] = useState("setup");
  const [fading, setFading] = useState(false);

  const [selectedRegion, setSelectedRegion] = useState(null);
  const [selectedProvinces, setSelectedProvinces] = useState([]);
  const [selectedMunicipalities, setSelectedMunicipalities] = useState([]);
  const [activeSectors, setActiveSectors] = useState(new Set(["basic", "higher", "techvoc"]));
  const [subcats, setSubcats] = useState(DEFAULT_SUBCATS);
  const [dimmed, setDimmed] = useState(DEFAULT_DIMMED);

  const [basemap, setBasemap] = useState("plain");
  const [gapVisible, setGapVisible] = useState(false);
  const [thresholdKm, setThresholdKm] = useState(3);
  const [selectedNode, setSelectedNode] = useState(null);

  const [nodeSize, setNodeSize] = useState(4);
  const [borderWidth, setBorderWidth] = useState(2);
  const [sectorColors, setSectorColors] = useState(DEFAULT_COLORS);
  const [colorblind, setColorblind] = useState(false);

  // "Clear map" mode — hides all overlay chrome (header, panels, legend, drawer) so the
  // user can read the map unobstructed. The restore control lives on the map itself.
  const [uiHidden, setUiHidden] = useState(false);

  const fadeTimer = useRef(null);
  // First landing appears instantly (no fade — the fade-in revealed the empty map behind
  // it, which read as a flash). Only "Change area" re-entry fades in over the live map.
  const enteredMapRef = useRef(false);

  useEffect(() => {
    loadAdminIndex();
  }, [loadAdminIndex]);

  // Region change → default to ALL provinces (provincial view is the default).
  const handleRegionChange = useCallback(
    (region) => {
      setSelectedRegion(region);
      setSelectedProvinces(provincesOf(adminIndex, region).map((p) => p.province));
      setSelectedMunicipalities([]);
    },
    [adminIndex]
  );

  const handleProvinceToggle = useCallback((province) => {
    setSelectedProvinces((prev) => {
      const next = prev.includes(province)
        ? prev.filter((p) => p !== province)
        : [...prev, province];
      if (next.length !== 1) setSelectedMunicipalities([]);
      return next;
    });
  }, []);

  const handleSelectAllProvinces = useCallback(() => {
    setSelectedProvinces(provincesOf(adminIndex, selectedRegion).map((p) => p.province));
    setSelectedMunicipalities([]);
  }, [adminIndex, selectedRegion]);

  const handleClearProvinces = useCallback(() => {
    setSelectedProvinces([]);
    setSelectedMunicipalities([]);
  }, []);

  const handleMunicipalityToggle = useCallback((psgc) => {
    setSelectedMunicipalities((prev) =>
      prev.includes(psgc) ? prev.filter((p) => p !== psgc) : [...prev, psgc]
    );
  }, []);

  const handleSectorToggle = useCallback((key) => {
    setActiveSectors((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleSubcatToggle = useCallback((sector, key) => {
    setSubcats((prev) => {
      const next = { ...prev, [sector]: new Set(prev[sector]) };
      if (next[sector].has(key)) next[sector].delete(key);
      else next[sector].add(key);
      return next;
    });
  }, []);

  // Dim = keep it on the map but push it back, so the user can highlight one level
  // without deleting the context around it.
  const handleDimToggle = useCallback((sector, key) => {
    setDimmed((prev) => {
      const next = { ...prev, [sector]: new Set(prev[sector]) };
      if (next[sector].has(key)) next[sector].delete(key);
      else next[sector].add(key);
      return next;
    });
  }, []);

  const handleSectorColor = useCallback((k, c) => {
    setSectorColors((prev) => ({ ...prev, [k]: c }));
  }, []);

  const handleColorblindToggle = useCallback(() => {
    setColorblind((prev) => {
      const nextOn = !prev;
      setSectorColors(nextOn ? CB_COLORS : DEFAULT_COLORS);
      return nextOn;
    });
  }, []);

  // Which municipality tiles the current selection implies.
  const effectiveMunicipalities = useCallback(() => {
    const provs = selectedProvinces;
    if (!selectedRegion || provs.length === 0) return [];
    if (provs.length >= 2) {
      const out = [];
      for (const prov of provs) {
        const p = provincesOf(adminIndex, selectedRegion).find((x) => x.province === prov);
        if (p) for (const m of p.municipalities) out.push(m.municity_psgc);
      }
      return out;
    }
    // Exactly one province: chosen municipalities, or all of them if none chosen.
    const p = provincesOf(adminIndex, selectedRegion).find((x) => x.province === provs[0]);
    if (!p) return [];
    return selectedMunicipalities.length
      ? selectedMunicipalities
      : p.municipalities.map((m) => m.municity_psgc);
  }, [adminIndex, selectedRegion, selectedProvinces, selectedMunicipalities]);

  const handleExplore = useCallback(() => {
    const munis = effectiveMunicipalities();
    if (!munis.length) return;
    enteredMapRef.current = true;
    evictAll();
    munis.forEach((psgc) => loadTile(psgc));
    setSelectedNode(null);
    setFading(true);
    clearTimeout(fadeTimer.current);
    fadeTimer.current = setTimeout(() => {
      setPhase("map");
      setFading(false);
    }, 320);
  }, [effectiveMunicipalities, evictAll, loadTile]);

  const handleChangeArea = useCallback(() => setPhase("setup"), []);

  const loadedCount = Object.keys(loadedTiles).length;
  const anyLoading = effectiveMunicipalities().some(isLoadingTile);

  // Borders follow what's being viewed: municipality borders only when the user has
  // drilled into specific cities/municipalities; province borders otherwise.
  const loadedKeys = useMemo(() => Object.keys(loadedTiles), [loadedTiles]);
  const borderLevel = selectedMunicipalities.length > 0 ? "municipal" : "provincial";
  const boundaries = useBoundaries(phase === "map" ? borderLevel : null, loadedKeys);

  // Derived once here, shared by the map and the detail drawer.
  const { nodes, places } = useMemo(
    () => collectNodes(loadedTiles, activeSectors, subcats),
    [loadedTiles, activeSectors, subcats]
  );
  // Road distances, precomputed by the pipeline (OSRM) and carried in the tiles.
  // `access` = what's reachable within 5 km by road; `nearest` = nearest of each level,
  // nationwide and unbounded (drives the halos and the drawer's "nearest" panel).
  const accessIndex = useMemo(() => buildAccessIndex(loadedTiles), [loadedTiles]);
  const nearestIndex = useMemo(() => buildNearestIndex(loadedTiles), [loadedTiles]);
  const stats = useMemo(
    () => accessibilityStats(selectedNode, nodes, accessIndex, nearestIndex, thresholdKm),
    [selectedNode, nodes, accessIndex, nearestIndex, thresholdKm]
  );

  return (
    <div className="relative flex flex-col h-screen w-screen bg-gray-50 overflow-hidden">
      {!uiHidden && (
      <header className="flex items-center gap-3 px-4 py-2 bg-white border-b border-gray-200 z-10 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-blue-600">Ugnay</span>
          <span className="text-xs text-gray-400 hidden sm:inline">Education Institutions Map</span>
        </div>

        <button
          onClick={handleChangeArea}
          className="text-xs rounded px-2 py-1 border border-gray-200 text-gray-600 hover:border-gray-400"
        >
          ← Change area
        </button>

        {/* Sector layer toggles */}
        <div className="flex items-center gap-1.5 ml-2">
          {[
            ["basic", "Basic", "bg-blue-500"],
            ["higher", "Higher", "bg-green-500"],
            ["techvoc", "Tech-Voc", "bg-purple-500"],
          ].map(([key, label, dot]) => {
            const on = activeSectors.has(key);
            return (
              <button
                key={key}
                onClick={() => handleSectorToggle(key)}
                className={`flex items-center gap-1.5 text-xs rounded px-2 py-0.5 border transition-all ${
                  on ? "bg-gray-800 text-white border-transparent" : "bg-white text-gray-400 border-gray-200"
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${dot} ${on ? "" : "opacity-40"}`} />
                {label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3 ml-auto">
          <button
            onClick={() => setGapVisible((v) => !v)}
            title="Halo every institution that cannot reach its next level within the distance threshold."
            className={`text-xs rounded px-2.5 py-1 border transition-all ${
              gapVisible
                ? "bg-amber-500 text-white border-transparent"
                : "bg-white text-gray-500 border-gray-300 hover:border-gray-400"
            }`}
          >
            {gapVisible ? "Hide gap analysis" : "Gap analysis"}
          </button>

          <div className="flex items-center rounded border border-gray-200 overflow-hidden">
            {["plain", "satellite", "roads"].map((b) => (
              <button
                key={b}
                onClick={() => setBasemap(b)}
                className={`text-xs px-2 py-1 capitalize transition-all ${
                  basemap === b ? "bg-gray-800 text-white" : "bg-white text-gray-500 hover:bg-gray-50"
                }`}
              >
                {b}
              </button>
            ))}
          </div>

          {anyLoading && <span className="text-xs text-blue-500 animate-pulse">Loading…</span>}
        </div>
      </header>
      )}

      {/* The map fills this box and NEVER changes size — the drawer overlays it. Resizing
          the map container reallocates MapLibre's WebGL buffer, which clears it to white;
          animating a width did that every frame and made the map flash on every click.
          `ugnay-drawer-open` slides MapLibre's own bottom-right zoom controls clear of the
          drawer (see index.css). */}
      <div
        className={`flex-1 relative overflow-hidden ${selectedNode && !uiHidden ? "ugnay-drawer-open" : ""}`}
      >
          <ErrorBoundary>
            <MapView
              nodes={nodes}
              places={places}
              accessIndex={accessIndex}
              nearestIndex={nearestIndex}
              tiles={loadedTiles}
              activeSectors={activeSectors}
              subcats={subcats}
              dimmed={dimmed}
              thresholdKm={thresholdKm}
              gapVisible={gapVisible}
              boundaries={boundaries}
              borderWidth={borderWidth}
              mapStyle={BASEMAPS[basemap]}
              nodeSize={nodeSize}
              sectorColors={sectorColors}
              selectedNode={selectedNode}
              onNodeClick={setSelectedNode}
              uiHidden={uiHidden}
              onToggleUiHidden={() => setUiHidden((v) => !v)}
            />
          </ErrorBoundary>

          {!uiHidden && (
          <FilterPanel
            drawerOpen={!!selectedNode}
            activeSectors={activeSectors}
            subcats={subcats}
            onSubcatToggle={handleSubcatToggle}
            dimmed={dimmed}
            onDimToggle={handleDimToggle}
            thresholdKm={thresholdKm}
            onThreshold={setThresholdKm}
            nodeSize={nodeSize}
            onNodeSize={setNodeSize}
            borderWidth={borderWidth}
            onBorderWidth={setBorderWidth}
            sectorColors={sectorColors}
            onSectorColor={handleSectorColor}
            colorblind={colorblind}
            onColorblindToggle={handleColorblindToggle}
          />
          )}

          {!uiHidden && (
          <Legend
            sectorColors={sectorColors}
            gapVisible={gapVisible}
            thresholdKm={thresholdKm}
          />
          )}

          {loadedCount === 0 && !anyLoading && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-white/80 rounded-xl px-6 py-4 text-center text-gray-500 text-sm shadow">
                No institutions loaded. Use “Change area” to pick a location.
              </div>
            </div>
          )}

          {/* Detail for the pinned institution. Overlays the map and slides in on a
              transform — see DetailDrawer for why it must not resize the map. */}
          {!uiHidden && (
          <DetailDrawer
            node={selectedNode}
            place={places[selectedNode?.node_id]}
            colors={sectorColors}
            stats={stats}
            thresholdKm={thresholdKm}
            onClose={() => setSelectedNode(null)}
          />
          )}
      </div>

      {phase === "setup" && (
        <SetupView
          adminIndex={adminIndex}
          isLoadingIndex={isLoadingIndex}
          selectedRegion={selectedRegion}
          selectedProvinces={selectedProvinces}
          selectedMunicipalities={selectedMunicipalities}
          activeSectors={activeSectors}
          onRegionChange={handleRegionChange}
          onProvinceToggle={handleProvinceToggle}
          onSelectAllProvinces={handleSelectAllProvinces}
          onClearProvinces={handleClearProvinces}
          onMunicipalityToggle={handleMunicipalityToggle}
          onSectorToggle={handleSectorToggle}
          onExplore={handleExplore}
          fading={fading}
          instant={!enteredMapRef.current}
        />
      )}
    </div>
  );
}
