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
import useIsMobile from "./lib/useIsMobile";
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

// Shape is a SECOND encoding channel alongside colour: it survives greyscale printing and
// stays readable for the ~8% of men with a colour-vision deficiency, where the five fills
// can collapse into two or three.
//
// The default carries meaning rather than being decorative — shape = SECTOR, fill =
// public/private within it:
//   DepEd ○   ·   Higher-ed △   ·   TESDA □
// so a glance at a silhouette tells you the sector even in a dense cluster. Diamond is
// left unused, free for the user to reassign. Any swatch can be overridden individually.
const DEFAULT_SHAPES = {
  public: "circle",
  private: "circle",
  hei_public: "triangle",
  hei_private: "triangle",
  tesda: "square",
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
  const [nodeShapes, setNodeShapes] = useState(DEFAULT_SHAPES);
  const [colorblind, setColorblind] = useState(false);

  // Phones get a different chrome entirely (bottom sheet, no floating panels), so the
  // layout branches on one shared breakpoint rather than on ad-hoc `sm:` guesses.
  const isMobile = useIsMobile();

  // "Clear map" mode — hides all overlay chrome (header, panels, legend, drawer) so the
  // user can read the map unobstructed. The restore control lives on the map itself.
  const [uiHidden, setUiHidden] = useState(false);

  // Ticks on every "Explore map". MapView uses it to know a NEW area is arriving, so it can
  // hold the nodes hidden until the tiles are all in and fade them up with the camera.
  // A plain counter (not a boolean) so two explores of the same area still fire.
  const [exploreSeq, setExploreSeq] = useState(0);

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

  const handleSectorShape = useCallback((k, shape) => {
    setNodeShapes((prev) => ({ ...prev, [k]: shape }));
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
    setExploreSeq((n) => n + 1); // tells MapView to hold the nodes back until the area is in
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

  // h-[100dvh], not h-screen. `vh` is the LARGEST viewport — it deliberately ignores the
  // mobile browser's URL and nav bars, so the app's bottom edge (and with it the "Explore
  // map" button) sat underneath them until the chrome auto-hid. `dvh` tracks the chrome as
  // it shows and hides, so the button is reachable immediately.
  return (
    <div className="relative h-[100dvh] w-screen bg-gray-50 overflow-hidden">
      {/* The header OVERLAYS the map rather than sitting above it in flow. That is what lets
          "clear map" mode slide it away smoothly: a flex sibling can only leave the layout,
          which would resize the map container — and every resize reallocates (and clears)
          MapLibre's WebGL buffer. Now the map is a fixed full-bleed box that NEVER changes
          size, for any reason. The auto-fit's 60px padding exceeds the header's 48px, so
          fitted institutions never land underneath it. */}
      <header
        aria-hidden={uiHidden}
        // Slid off-screen is not the same as gone: without `inert` the header's buttons stay
        // in the tab order, so a keyboard user would tab into a bar they cannot see. Same
        // rule as every other collapsible here (see TESTS.md, "Accessibility rule").
        inert={uiHidden}
        className={`absolute top-0 inset-x-0 h-12 flex items-center gap-3 px-3 sm:px-4 bg-white border-b border-gray-200 z-40
          transition-[transform,opacity] duration-300 ease-out will-change-transform ${
            uiHidden ? "-translate-y-full opacity-0 pointer-events-none" : "translate-y-0 opacity-100"
          }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg font-bold text-blue-600 shrink-0">Ugnay</span>
          <span className="text-xs text-gray-400 hidden sm:inline">Education Institutions Map</span>
        </div>

        <button
          onClick={handleChangeArea}
          className="text-xs rounded px-2 py-1 border border-gray-200 text-gray-600 hover:border-gray-400 shrink-0 whitespace-nowrap"
        >
          ← Change area
        </button>

        {/* Sector toggles, gap analysis and basemap are DESKTOP-only here. On a phone they
            don't fit — they used to overflow and clip off the right edge — so they move
            into the bottom sheet, where they sit with the other map controls. */}
        {!isMobile && (
          <>
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
          </>
        )}

        {isMobile && anyLoading && (
          <span className="text-xs text-blue-500 animate-pulse ml-auto shrink-0">Loading…</span>
        )}
      </header>

      {/* The map fills this box and NEVER changes size — the drawer overlays it. Resizing
          the map container reallocates MapLibre's WebGL buffer, which clears it to white;
          animating a width did that every frame and made the map flash on every click.
          `ugnay-drawer-open` slides MapLibre's own bottom-right zoom controls clear of the
          drawer (see index.css). */}
      <div
        className={`absolute inset-0 overflow-hidden ${
          selectedNode && !uiHidden && !isMobile ? "ugnay-drawer-open" : ""
        } ${isMobile ? "ugnay-mobile" : ""}`}
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
              nodeShapes={nodeShapes}
              selectedNode={selectedNode}
              onNodeClick={setSelectedNode}
              uiHidden={uiHidden}
              onToggleUiHidden={() => setUiHidden((v) => !v)}
              isMobile={isMobile}
              loading={anyLoading}
              exploreSeq={exploreSeq}
            />
          </ErrorBoundary>

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
            nodeShapes={nodeShapes}
            onSectorShape={handleSectorShape}
            colorblind={colorblind}
            onColorblindToggle={handleColorblindToggle}
            isMobile={isMobile}
            onSectorToggle={handleSectorToggle}
            gapVisible={gapVisible}
            onGapToggle={() => setGapVisible((v) => !v)}
            basemap={basemap}
            onBasemap={setBasemap}
            uiHidden={uiHidden}
          />

          {/* On mobile the legend is a TAB inside the bottom sheet — a floating legend and
              a bottom sheet would fight over the same corner of a small screen. */}
          {!isMobile && (
          <Legend
            sectorColors={sectorColors}
            nodeShapes={nodeShapes}
            gapVisible={gapVisible}
            thresholdKm={thresholdKm}
            uiHidden={uiHidden}
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
              transform — see DetailDrawer for why it must not resize the map.
              In clear-map mode we pass node={null}: the drawer then slides out on the exact
              path it already uses, so hiding the UI needs no separate animation. */}
          <DetailDrawer
            node={uiHidden ? null : selectedNode}
            place={places[selectedNode?.node_id]}
            colors={sectorColors}
            stats={stats}
            thresholdKm={thresholdKm}
            onClose={() => setSelectedNode(null)}
            isMobile={isMobile}
          />
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
          isMobile={isMobile}
        />
      )}
    </div>
  );
}
