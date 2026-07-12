import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import Map, { Source, Layer, Popup, NavigationControl } from "react-map-gl/maplibre";
import { LocateFixed, Eye, EyeOff } from "lucide-react";
import { accessibilityEdges, fillKey, gapStatus, nodeDimmed } from "../lib/graph";
import { addShapeImages, iconSizeFor, shapeImageId } from "../lib/nodeShapes";
import InstitutionCard from "./InstitutionCard";

const INITIAL_VIEW_STATE = {
  latitude: 12.5,
  longitude: 122.0,
  zoom: 5.5,
  pitch: 0,
  bearing: 0,
};

const EMPTY_FC = { type: "FeatureCollection", features: [] };

// Keep in step with DetailDrawer: `w-72` (18rem) as a right drawer on desktop, `h-[60vh]`
// as a bottom sheet on mobile. EDGE_MARGIN keeps a selected node off the panel's very
// edge, so its edge fan still has room to fan out.
const DRAWER_W = 288;
const SHEET_H = Math.round((typeof window !== "undefined" ? window.innerHeight : 800) * 0.6);
const EDGE_MARGIN = 72;

// line-cap/line-join are LAYOUT properties. In `paint`, MapLibre silently rejects the
// whole layer at addLayer() — the layer just never exists. Keep them here.
const LINE_LAYOUT = { "line-cap": "round", "line-join": "round" };

const HALO_COLOR = ["match", ["get", "gap"], "red", "#DC2626", "amber", "#F59E0B", "#00000000"];

function nodesGeoJSON(nodes, nearestIndex, thresholdKm, gapVisible, subcats, dimmed) {
  return {
    type: "FeatureCollection",
    features: nodes.map((n) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [n.lon, n.lat] },
      properties: {
        node_id: n.node_id,
        fill: fillKey(n),
        source: n.source,
        dim: nodeDimmed(n, subcats, dimmed),
        gap: gapVisible ? gapStatus(n, nearestIndex, thresholdKm) : "",
      },
    })),
  };
}

function robustBounds(features) {
  if (!features.length) return null;
  const lons = features.map((f) => f.geometry.coordinates[0]).sort((a, b) => a - b);
  const lats = features.map((f) => f.geometry.coordinates[1]).sort((a, b) => a - b);
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(arr.length * p)))];
  return [
    [q(lons, 0.02), q(lats, 0.02)],
    [q(lons, 0.98), q(lats, 0.98)],
  ];
}

export default function MapView({
  nodes,
  places,
  accessIndex,
  nearestIndex,
  tiles,
  activeSectors,
  subcats,
  dimmed,
  thresholdKm,
  gapVisible,
  boundaries,
  borderWidth = 2,
  mapStyle,
  nodeSize,
  sectorColors,
  nodeShapes,
  selectedNode,
  onNodeClick,
  uiHidden,
  onToggleUiHidden,
  isMobile = false,
}) {
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  const [hoverNode, setHoverNode] = useState(null);
  const [ready, setReady] = useState(false);
  const mapRef = useRef(null);
  const hoverFidRef = useRef(null);

  const nodeIndex = useMemo(() => {
    const m = {};
    for (const n of nodes) m[n.node_id] = n;
    return m;
  }, [nodes]);

  const nodesFC = useMemo(
    () => nodesGeoJSON(nodes, nearestIndex, thresholdKm, gapVisible, subcats, dimmed),
    [nodes, nearestIndex, thresholdKm, gapVisible, subcats, dimmed]
  );

  // Accessibility edges for the pinned node: everything within the threshold BY ROAD
  // that offers something it doesn't. Read from the precomputed adjacency in the tiles.
  const { fc: edgesFC, connectedIds } = useMemo(
    () => accessibilityEdges(selectedNode, nodes, thresholdKm, accessIndex),
    [selectedNode, nodes, thresholdKm, accessIndex]
  );

  const selId = selectedNode?.node_id || "";

  const colorExpr = useMemo(
    () => [
      "match",
      ["get", "fill"],
      "public", sectorColors.public,
      "private", sectorColors.private,
      "hei_public", sectorColors.hei_public,
      "hei_private", sectorColors.hei_private,
      "tesda", sectorColors.tesda,
      "#888888",
    ],
    [sectorColors]
  );

  const edgeColorExpr = useMemo(
    () => [
      "match",
      ["get", "dest_fill"],
      "public", sectorColors.public,
      "private", sectorColors.private,
      "hei_public", sectorColors.hei_public,
      "hei_private", sectorColors.hei_private,
      "tesda", sectorColors.tesda,
      "#888888",
    ],
    [sectorColors]
  );

  // Nearer = thicker, scaled to the current threshold.
  const edgeWidth = useMemo(
    () => ["interpolate", ["linear"], ["get", "distance_km"], 0, 3.6, thresholdKm, 1.1],
    [thresholdKm]
  );

  // Two independent kinds of de-emphasis, in priority order:
  //   1. a pinned selection fades everything not on its fan
  //   2. the user's per-subcategory "dim" pushes a level back without hiding it
  const nodeOpacityExpr = useMemo(() => {
    const dimmedAlpha = 0.15;
    const base = ["case", ["get", "dim"], dimmedAlpha, 0.92];
    if (!selId) return base;
    const ids = [...new Set([selId, ...connectedIds])];
    return [
      "case",
      ["==", ["get", "node_id"], selId], 0.95,
      ["in", ["get", "node_id"], ["literal", ids]],
      ["case", ["get", "dim"], 0.5, 0.95],
      ["case", ["get", "dim"], 0.08, 0.16],
    ];
  }, [selId, connectedIds]);

  // Which SDF image each fill bucket draws with. The user picks a shape per swatch, so
  // this is the shape twin of `colorExpr` and is keyed the same way.
  const iconExpr = useMemo(
    () => [
      "match",
      ["get", "fill"],
      "public", shapeImageId(nodeShapes.public),
      "private", shapeImageId(nodeShapes.private),
      "hei_public", shapeImageId(nodeShapes.hei_public),
      "hei_private", shapeImageId(nodeShapes.hei_private),
      "tesda", shapeImageId(nodeShapes.tesda),
      shapeImageId("circle"),
    ],
    [nodeShapes]
  );

  // Symbol layers can't read feature-state (MapLibre supports it on circle/line/fill only),
  // so the pinned node's emphasis rides an expression on node_id — which it already did —
  // and the *hover* grow moves to a separate circle ring underneath (see `nodes-hover`).
  const symbolLayout = useMemo(
    () => ({
      "icon-image": iconExpr,
      "icon-size": [
        "case",
        ["==", ["get", "node_id"], selId], iconSizeFor(nodeSize + 4),
        iconSizeFor(nodeSize),
      ],
      // Institutions are points of fact, not labels: never let MapLibre declutter one away.
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    }),
    [iconExpr, selId, nodeSize]
  );

  const symbolPaint = useMemo(
    () => ({
      "icon-color": colorExpr,
      "icon-opacity": nodeOpacityExpr,
      "icon-opacity-transition": { duration: 260 },
      // The old circle-stroke: white hairline normally, dark ring when pinned.
      "icon-halo-color": ["case", ["==", ["get", "node_id"], selId], "#1e293b", "#ffffff"],
      "icon-halo-width": ["case", ["==", ["get", "node_id"], selId], 2.4, 1],
      "icon-halo-blur": 0,
    }),
    [colorExpr, selId, nodeOpacityExpr]
  );

  const fitKey =
    Object.keys(tiles).sort().join(",") + "|" + [...activeSectors].sort().join(",");
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const b = robustBounds(nodesFC.features);
    if (!b) return;
    map.fitBounds(b, { padding: 60, maxZoom: 14, duration: 800 });
  }, [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Waze-style re-center: snap the view back to frame the current area's institutions.
  // Same robust fit the auto-fit uses, but on demand.
  const recenter = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const b = robustBounds(nodesFC.features);
    if (b) map.fitBounds(b, { padding: 60, maxZoom: 14, duration: 800 });
  }, [nodesFC]);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (map && typeof window !== "undefined") window.__ugnayMap = map; // probe hook
  }, [ready]);

  // Register the shape images, and RE-register them on every style load. `setStyle` (i.e.
  // every basemap switch) throws away all images the app added; react-map-gl re-adds our
  // sources and layers for us, but not our images — so without this the symbol layers
  // would reference missing icons and every institution would vanish on the first switch.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    addShapeImages(map);
    const onStyle = () => addShapeImages(map);
    map.on("style.load", onStyle);
    return () => map.off("style.load", onStyle);
  }, [ready]);

  // NOTE: no ResizeObserver here. MapLibre already runs one on its own container
  // (`trackResize`, on by default), so a second one just doubled every resize — and each
  // resize reallocates and clears the WebGL buffer. The drawer no longer resizes the map
  // at all (it overlays and slides), so nothing here needs to react to it.

  // The drawer covers the right DRAWER_W px. If the node you just clicked would end up
  // underneath it, slide the map just far enough to bring it back into the open area —
  // a pan, not a resize, so nothing is cleared. Nodes already in the clear are left alone:
  // the map should sit still when it doesn't need to move.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !selectedNode) return;
    const box = map.getContainer();
    const { x, y } = map.project([selectedNode.lon, selectedNode.lat]);
    if (isMobile) {
      // On mobile the detail view is a BOTTOM sheet, so the node hides below, not behind:
      // pan up by however far it sits into the sheet.
      const clearHeight = box.clientHeight - SHEET_H;
      const overshoot = y - (clearHeight - EDGE_MARGIN);
      if (overshoot > 0) map.panBy([0, overshoot], { duration: 380 });
      return;
    }
    const openWidth = box.clientWidth - DRAWER_W;
    const overshoot = x - (openWidth - EDGE_MARGIN);
    if (overshoot > 0) map.panBy([overshoot, 0], { duration: 380 });
  }, [selectedNode, isMobile]);

  const handleClick = useCallback(
    (e) => {
      const f = e.features && e.features[0];
      if (!f) {
        onNodeClick(null);
        return;
      }
      onNodeClick(nodeIndex[f.properties.node_id] || null);
    },
    [onNodeClick, nodeIndex]
  );

  const handleMouseMove = useCallback(
    (e) => {
      const map = mapRef.current?.getMap();
      if (!map) return;
      const f = e.features && e.features[0];
      if (hoverFidRef.current != null) {
        map.setFeatureState({ source: "nodes", id: hoverFidRef.current }, { hover: false });
        hoverFidRef.current = null;
      }
      if (f) {
        map.getCanvas().style.cursor = "pointer";
        hoverFidRef.current = f.id;
        map.setFeatureState({ source: "nodes", id: f.id }, { hover: true });
        const n = nodeIndex[f.properties.node_id];
        setHoverNode((prev) => (prev?.node_id === n?.node_id ? prev : n || null));
      } else {
        map.getCanvas().style.cursor = "";
        setHoverNode(null);
      }
    },
    [nodeIndex]
  );

  const handleMouseLeave = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (map && hoverFidRef.current != null) {
      map.setFeatureState({ source: "nodes", id: hoverFidRef.current }, { hover: false });
      hoverFidRef.current = null;
      map.getCanvas().style.cursor = "";
    }
    setHoverNode(null);
  }, []);

  const NODE_LAYERS = ["nodes-basic", "nodes-higher", "nodes-techvoc"];
  // Don't double up: while a node is pinned, don't also hover-card it.
  const showHover = hoverNode && hoverNode.node_id !== selId;

  return (
    <Map
      ref={mapRef}
      {...viewState}
      onMove={(e) => setViewState(e.viewState)}
      onLoad={() => setReady(true)}
      onError={(e) => console.error("MAPLIBRE ERROR:", e?.error?.message || e)}
      style={{ width: "100%", height: "100%" }}
      mapStyle={mapStyle}
      interactiveLayerIds={NODE_LAYERS}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <NavigationControl position="bottom-right" showCompass={false} />

      {/* Persistent map controls, stacked above MapLibre's own zoom +/-. These stay on
          screen even in clear-map mode, so the UI is always recoverable. Shifts with the
          drawer via `.ugnay-map-controls` in index.css, matching the zoom control.
          bottom-32 (8rem) clears MapLibre's zoom block, whose top edge sits ~112px above
          the map's bottom edge: at bottom-20 this stack covered the zoom-IN button
          outright and made it unclickable. Keep ≥ 8rem if either stack changes height. */}
      <div className="ugnay-map-controls absolute right-2.5 bottom-32 z-10 flex flex-col gap-2">
        <button
          onClick={recenter}
          title="Re-center on this area"
          className="w-8 h-8 flex items-center justify-center rounded-md bg-white/95 backdrop-blur shadow-md border border-gray-200 text-gray-600 hover:text-gray-900 hover:shadow-lg transition-colors"
        >
          <LocateFixed size={16} />
        </button>
        <button
          onClick={onToggleUiHidden}
          title={uiHidden ? "Show panels" : "Hide panels for a clear map view"}
          className="w-8 h-8 flex items-center justify-center rounded-md bg-white/95 backdrop-blur shadow-md border border-gray-200 text-gray-600 hover:text-gray-900 hover:shadow-lg transition-colors"
        >
          {uiHidden ? <Eye size={16} /> : <EyeOff size={16} />}
        </button>
      </div>

      {/* Administrative borders — a visual guide only. Drawn first (underneath
          everything): solid and muted, so it outlines without competing with the data.
          Thickness is user-controlled (0 hides them). */}
      <Source id="borders" type="geojson" data={boundaries || EMPTY_FC}>
        <Layer
          id="borders-line"
          type="line"
          layout={LINE_LAYOUT}
          paint={{
            "line-color": "#64748b",
            "line-width": borderWidth,
            "line-opacity": borderWidth > 0 ? 0.55 : 0,
          }}
        />
      </Source>

      {/* Accessibility edges for the pinned institution (below the nodes). */}
      <Source id="edges" type="geojson" data={selectedNode ? edgesFC : EMPTY_FC}>
        <Layer
          id="edges-layer"
          type="line"
          layout={LINE_LAYOUT}
          paint={{
            "line-color": edgeColorExpr,
            "line-width": edgeWidth,
            "line-opacity": selectedNode ? 0.85 : 0,
            "line-opacity-transition": { duration: 300 },
          }}
        />
      </Source>

      {/* Nodes. Rings sit underneath so the sector shape always reads on top.
          Z-order: gap halo → hover ring → basic → higher → tech-voc (rarer sectors are
          never buried). The three sector layers are symbol layers so each fill bucket can
          carry its own SHAPE; they share one layout/paint pair. */}
      <Source id="nodes" type="geojson" data={nodesFC} generateId>
        <Layer
          id="nodes-halo"
          type="circle"
          filter={["!=", ["get", "gap"], ""]}
          paint={{
            "circle-radius": nodeSize + 4.5,
            "circle-color": "rgba(0,0,0,0)",
            "circle-stroke-color": HALO_COLOR,
            "circle-stroke-width": 2.4,
            "circle-stroke-opacity": 0.9,
          }}
        />
        {/* Hover feedback. The nodes themselves are symbols now and symbols can't read
            feature-state, so the "grow on hover" becomes a ring that fades in under the
            node — same signal, and it works for every shape. */}
        <Layer
          id="nodes-hover"
          type="circle"
          paint={{
            "circle-radius": nodeSize + 3.5,
            "circle-color": "rgba(0,0,0,0)",
            "circle-stroke-color": "#1e293b",
            "circle-stroke-width": 1.6,
            "circle-stroke-opacity": [
              "case",
              ["boolean", ["feature-state", "hover"], false], 0.55,
              0,
            ],
            "circle-stroke-opacity-transition": { duration: 140 },
          }}
        />
        <Layer
          id="nodes-basic"
          type="symbol"
          filter={["in", ["get", "source"], ["literal", ["public", "private"]]]}
          layout={symbolLayout}
          paint={symbolPaint}
        />
        <Layer
          id="nodes-higher"
          type="symbol"
          filter={["==", ["get", "source"], "hei"]}
          layout={symbolLayout}
          paint={symbolPaint}
        />
        <Layer
          id="nodes-techvoc"
          type="symbol"
          filter={["==", ["get", "source"], "tesda"]}
          layout={symbolLayout}
          paint={symbolPaint}
        />
      </Source>

      {/* Hover: transient card, no close button. */}
      {showHover && (
        <Popup
          longitude={hoverNode.lon}
          latitude={hoverNode.lat}
          closeButton={false}
          closeOnClick={false}
          anchor="bottom"
          offset={14}
          maxWidth="none"
          className="ugnay-popup ugnay-popup--hover"
        >
          <InstitutionCard
            node={hoverNode}
            colors={sectorColors}
            place={places[hoverNode.node_id]}
          />
        </Popup>
      )}

      {/* NOTE: there is deliberately NO pinned popup. Detail for the clicked institution
          lives in the side drawer — a popup anchored to the node always covered part of
          its own edge fan, and edges radiate in every direction, so no anchor is safe. */}
    </Map>
  );
}
