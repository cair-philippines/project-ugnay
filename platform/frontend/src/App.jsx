import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTiles } from "./hooks/useTiles";
import { useBoundaries } from "./hooks/useBoundaries";
import { collectNodes, buildAccessIndex, buildNearestIndex, SECTOR_GROUPS } from "./lib/graph";
import { PATHWAYS } from "./lib/progression";
import { accessibilityStats } from "./lib/stats";
import SetupView from "./components/SetupView";
import MapView from "./components/MapView";
import NetworkView from "./components/NetworkView";
import NetworkLegend from "./components/NetworkLegend";
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

// The NETWORK always graphs the whole loaded area, regardless of what the map's sector
// filters are set to. Those filters answer "what do I want to look at"; the network answers
// "what does the structure look like", and a structure with pieces missing is not a quieter
// answer to that question — it is a wrong one. A learner's pathway runs through a TESDA
// centre whether or not the user has TESDA switched on.
const NETWORK_SECTORS = new Set(["basic", "higher", "techvoc"]);
const NETWORK_SUBCATS = DEFAULT_SUBCATS();

// How long NetworkView keeps drawing after `view` flips back to "map": long enough for it to
// fold the graph back down onto the map's own pins. See NetworkView's MORPH_MS.
const NETWORK_EXIT_MS = 460;

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

  // "map" | "network". Two readings of the same institutions: WHERE they are, and whether
  // their pathway goes anywhere. The network view is not a prettier map — it answers a
  // question the map structurally cannot (see lib/progression.js).
  const [view, setView] = useState("map");
  const [pathway, setPathway] = useState("academic");
  const [showReskilling, setShowReskilling] = useState(false);

  // The network's two filter families. BOTH start empty: the graph opens grey and unasked,
  // and toggling something is the first move. `netFills` colours by sector (the map's own
  // colours); `netVerdicts` lights the chain verdict and fades everything else back.
  const [netFills, setNetFills] = useState(() => new Set());
  const [netVerdicts, setNetVerdicts] = useState(() => new Set());

  // NetworkView outlives `view === "network"` by one animation: on the way out it folds the
  // graph back down onto the map's pins, and it cannot do that after it has been unmounted.
  const [netMounted, setNetMounted] = useState(false);
  const netExiting = netMounted && view !== "network";

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

  // Bumped only to recover from a lost WebGL context (see MapView): remounting MapView
  // builds a brand-new map with a fresh context. The tiles are already in memory, so this
  // costs a re-fit, not a re-download — and it beats the alternative, which is a frozen map
  // that only a manual page reload can fix.
  const [mapKey, setMapKey] = useState(0);
  const handleContextLost = useCallback(() => setMapKey((n) => n + 1), []);

  // The live MapLibre instance. The network view borrows its projection so the graph can
  // start as an exact copy of the map and unfold out of it — and fold back onto it on the
  // way home. Held in a ref, not state: it changes on map load, and re-rendering the whole
  // app for that would remount the very thing we just got a handle on.
  const mapRef = useRef(null);
  const handleMapReady = useCallback((map) => {
    mapRef.current = map;
  }, []);
  // node → its screen position, in the same coordinate space as the network canvas (both
  // are inset-0 in the same box). Null for a node the map cannot place.
  const projectNode = useCallback((n) => {
    const map = mapRef.current;
    if (!map || !Number.isFinite(n?.lon) || !Number.isFinite(n?.lat)) return null;
    try {
      const p = map.project([n.lon, n.lat]);
      return Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
    } catch {
      return null;
    }
  }, []);

  // "Show on the map" — the explicit hand-off from a node in the graph to its place on the
  // ground. It waits for the fold-back to finish before flying: the morph aims at where the
  // pins are NOW, so moving the camera mid-morph would have the graph chasing a target that
  // is running away from it.
  const [focusSeq, setFocusSeq] = useState(0);
  const focusTimer = useRef(null);
  const handleShowOnMap = useCallback(() => {
    setView("map");
    clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => setFocusSeq((n) => n + 1), NETWORK_EXIT_MS + 60);
  }, []);

  const handleToggleVerdict = useCallback((v) => {
    setNetVerdicts((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  }, []);

  const handleToggleFill = useCallback((f) => {
    setNetFills((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  }, []);

  const handleToggleFillGroup = useCallback((groupKey, on) => {
    const fills = SECTOR_GROUPS.find((g) => g.key === groupKey)?.fills || [];
    setNetFills((prev) => {
      const next = new Set(prev);
      for (const f of fills) {
        if (on) next.add(f);
        else next.delete(f);
      }
      return next;
    });
  }, []);

  const fadeTimer = useRef(null);
  // First landing appears instantly (no fade — the fade-in revealed the empty map behind
  // it, which read as a flash). Only "Change area" re-entry fades in over the live map.
  const enteredMapRef = useRef(false);

  useEffect(() => {
    loadAdminIndex();
  }, [loadAdminIndex]);

  // Mount the network on entry; keep it mounted through its exit animation.
  useEffect(() => {
    if (view === "network") {
      setNetMounted(true);
      return;
    }
    if (!netMounted) return;
    const t = setTimeout(() => setNetMounted(false), NETWORK_EXIT_MS);
    return () => clearTimeout(t);
  }, [view, netMounted]);

  useEffect(() => () => clearTimeout(focusTimer.current), []);

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
  //
  // Deliberately NOT gated on `phase === "map"`: the boundary files are 3.4 MB (provincial)
  // and 6.6 MB (municipal), and `res.json()` parses them ON THE MAIN THREAD. Loading them at
  // Explore time put a ~400ms stall squarely inside the node reveal — the browser painted no
  // frames at all while it parsed, so the 450ms fade came out as two frames, i.e. a pop.
  // Starting the fetch during setup means the parse happens while the user is reading the
  // preamble and picking an area, when nothing is animating and a stall is invisible; by the
  // time they press Explore it is parsed and cached.
  const loadedKeys = useMemo(() => Object.keys(loadedTiles), [loadedTiles]);
  const borderLevel = selectedMunicipalities.length > 0 ? "municipal" : "provincial";
  const boundaries = useBoundaries(borderLevel, loadedKeys);

  // Derived once here, shared by the map and the detail drawer.
  const { nodes, places } = useMemo(
    () => collectNodes(loadedTiles, activeSectors, subcats),
    [loadedTiles, activeSectors, subcats]
  );
  // The network's node set: everything loaded, unfiltered (see NETWORK_SECTORS above).
  const netNodes = useMemo(
    () => collectNodes(loadedTiles, NETWORK_SECTORS, NETWORK_SUBCATS).nodes,
    [loadedTiles]
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
          {/* Agency logos — desktop only; mobile header is already full. DepEd always left
              of ECAIR per brand rule. Title on ECAIR carries the "developed by" attribution
              for hover-aware users without cluttering the bar. */}
          <div className="hidden sm:flex items-center gap-2 shrink-0">
            <img src="/logos/deped.svg" alt="Department of Education" className="h-7 w-auto" />
            <img
              src="/logos/ecair.png"
              alt="Education Center for AI Research Philippines"
              title="This platform is developed by the Education Center for AI Research."
              className="h-7 w-auto"
            />
          </div>
          <div className="hidden sm:block w-px h-5 bg-gray-200 shrink-0" />
          <span className="text-lg font-bold text-blue-600 shrink-0">Ugnay</span>
          {/* Subtitle hidden at sm–lg to give logos the space they displace; visible again
              on large screens where there is room for both. */}
          <span className="text-xs text-gray-400 hidden lg:inline">Education Institutions Map</span>
        </div>

        <button
          onClick={handleChangeArea}
          className="text-xs rounded px-2 py-1 border border-gray-200 text-gray-600 hover:border-gray-400 shrink-0 whitespace-nowrap"
        >
          ← Change area
        </button>

        {/* Map ⇄ Network. A segmented control, not a checkbox: these are two views of one
            dataset, and neither is a mode of the other. */}
        <div className="flex items-center rounded border border-gray-200 overflow-hidden shrink-0">
          {[
            ["map", "Map"],
            ["network", "Network"],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setView(key)}
              title={
                key === "map"
                  ? "Where institutions are"
                  : "Whether their pathway leads anywhere"
              }
              className={`text-xs px-2.5 py-1 transition-all ${
                view === key ? "bg-gray-800 text-white" : "bg-white text-gray-500 hover:bg-gray-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Sector toggles, gap analysis and basemap are DESKTOP-only here. On a phone they
            don't fit — they used to overflow and clip off the right edge — so they move
            into the bottom sheet, where they sit with the other map controls.
            They are also MAP-only: the network always graphs the whole area (see
            NETWORK_SECTORS), so a sector switch here would do nothing to it — and a control
            that silently does nothing is worse than one that isn't there. The network's own
            sector control lives in the filter panel and COLOURS rather than hides. */}
        {!isMobile && (
          <>
            {view === "map" && (
              <div className="flex items-center gap-1.5 ml-2">
                {[
                  ["basic", "Basic", "public"],
                  ["higher", "Higher", "hei_public"],
                  ["techvoc", "Tech-Voc", "tesda"],
                ].map(([key, label, swatchKey]) => {
                  const on = activeSectors.has(key);
                  return (
                    <button
                      key={key}
                      onClick={() => handleSectorToggle(key)}
                      className={`flex items-center gap-1.5 text-xs rounded px-2 py-0.5 border transition-all ${
                        on ? "bg-gray-800 text-white border-transparent" : "bg-white text-gray-400 border-gray-200"
                      }`}
                    >
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: sectorColors[swatchKey], opacity: on ? 1 : 0.4 }}
                      />
                      {label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Gap analysis and the basemap are MAP controls — a halo and a satellite layer
                mean nothing in a force layout. They leave with the map rather than sit
                there inert. */}
            <div className="flex items-center gap-3 ml-auto">
              {view === "map" && (
                <>
                  <button
                    onClick={() => setGapVisible((v) => !v)}
                    title="Rings every institution that can't reach its next level within the distance you set."
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
                </>
              )}

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
              key={mapKey}
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
              onContextLost={handleContextLost}
              onMapReady={handleMapReady}
              focusSeq={focusSeq}
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
            // The Legend tab must key off the ACTIVE view: the two use different grammars
            // (map fill = sector; network fill = verdict), so showing the map's key over a
            // network graph would be wrong, not merely unhelpful.
            view={view}
            pathway={pathway}
            pathwayEnds={PATHWAYS[pathway].ends}
            showReskilling={showReskilling}
            onToggleReskilling={() => setShowReskilling((v) => !v)}
            netFills={netFills}
            netVerdicts={netVerdicts}
            onToggleFill={handleToggleFill}
            onToggleFillGroup={handleToggleFillGroup}
            onToggleVerdict={handleToggleVerdict}
          />

          {/* The network OVERLAYS the map rather than replacing it. Unmounting MapView would
              throw away its WebGL context (and the fitted camera); hiding it with
              `display:none` would resize its container to zero, which reallocates and
              clears that context's buffer — the same defect that made the map flash white
              on every click. Leaving it mounted at full size underneath costs an idle map
              and nothing else — and it is what makes the transition possible at all: the
              graph is SEEDED from the map's live projection, so it opens as a pixel-perfect
              copy of the map and unfolds out of it. */}
          {netMounted && (
            <ErrorBoundary>
              <NetworkView
                nodes={netNodes}
                accessIndex={accessIndex}
                nearestIndex={nearestIndex}
                thresholdKm={thresholdKm}
                pathway={pathway}
                onPathway={setPathway}
                sectorColors={sectorColors}
                nodeShapes={nodeShapes}
                showReskilling={showReskilling}
                netFills={netFills}
                netVerdicts={netVerdicts}
                onToggleVerdict={handleToggleVerdict}
                selectedNode={selectedNode}
                onNodeClick={setSelectedNode}
                isMobile={isMobile}
                projectNode={projectNode}
                exiting={netExiting}
              />
            </ErrorBoundary>
          )}

          {/* On mobile the legend is a TAB inside the bottom sheet — a floating legend and
              a bottom sheet would fight over the same corner of a small screen. */}
          {!isMobile && view === "map" && (
          <Legend
            sectorColors={sectorColors}
            nodeShapes={nodeShapes}
            gapVisible={gapVisible}
            thresholdKm={thresholdKm}
            uiHidden={uiHidden}
          />
          )}

          {!isMobile && view === "network" && (
            <NetworkLegend
              sectorColors={sectorColors}
              nodeShapes={nodeShapes}
              pathway={pathway}
              thresholdKm={thresholdKm}
              showReskilling={showReskilling}
              onToggleReskilling={() => setShowReskilling((v) => !v)}
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
            nearestIndex={nearestIndex}
            onClose={() => setSelectedNode(null)}
            isMobile={isMobile}
            view={view}
            onShowOnMap={handleShowOnMap}
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
