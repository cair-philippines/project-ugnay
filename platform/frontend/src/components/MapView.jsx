import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import Map, { Source, Layer, Popup, NavigationControl } from "react-map-gl/maplibre";
import { LocateFixed, Eye, EyeOff } from "lucide-react";
import { accessibilityEdges, fillKey, gapStatus, nodeDimmed } from "../lib/graph";
import {
  addShapeImages,
  haloWidthFor,
  haloWidthSelectedFor,
  iconSizeFor,
  shapeImageId,
} from "../lib/nodeShapes";
import InstitutionCard from "./InstitutionCard";

const INITIAL_VIEW_STATE = {
  latitude: 12.5,
  longitude: 122.0,
  zoom: 5.5,
  pitch: 0,
  bearing: 0,
};

const EMPTY_FC = { type: "FeatureCollection", features: [] };

// Keep in step with DetailDrawer: `w-72` (18rem) as a right drawer on desktop,
// `h-[60dvh]` as a bottom sheet on mobile. EDGE_MARGIN keeps a selected node off the
// panel's very edge, so its edge fan still has room to fan out.
const DRAWER_W = 288;
const EDGE_MARGIN = 72;

// Measured, not frozen at import: `dvh` shrinks and grows as the mobile browser's chrome
// hides and shows, so a constant captured once would drift out of step with the sheet it
// is supposed to describe.
const sheetHeight = () => Math.round(window.innerHeight * 0.6);

// line-cap/line-join are LAYOUT properties. In `paint`, MapLibre silently rejects the
// whole layer at addLayer() — the layer just never exists. Keep them here.
const LINE_LAYOUT = { "line-cap": "round", "line-join": "round" };

const HALO_COLOR = ["match", ["get", "gap"], "red", "#DC2626", "amber", "#F59E0B", "#00000000"];

// How long the institutions take to fade up once an area has finished loading.
const REVEAL_MS = 450;
// Filter/sector toggles: fade out then fade in so nodes don't hard-pop.
const FILTER_FADE_OUT_MS = 120;
const FILTER_FADE_IN_MS = 250;
// The resting alpha of an ordinary node. Now carried in the icon COLOUR's alpha channel,
// not in icon-opacity — see the note on `revealed`.
const NODE_ALPHA = 0.92;

const SECTOR_KEYS = ["public", "private", "hei_public", "hei_private", "tesda"];
const SELECTED_HALO_RGB = [30, 41, 59]; // #1e293b

// Drives a single sector layer through fade-out → source update → fade-in. Called once per
// sector that changed. The midpoint callback is what defers the source update: nodes being
// removed stay in the source (and on screen, fading) until opacity reaches 0, then the source
// swaps to the new set and the fade-in begins on the survivors.
function startSectorFade(setPhase, timerRef, onMidpoint) {
  clearTimeout(timerRef.current);
  setPhase("fading-out");
  timerRef.current = setTimeout(() => {
    onMidpoint();
    setPhase("fading-in");
    timerRef.current = setTimeout(() => setPhase("idle"), FILTER_FADE_IN_MS);
  }, FILTER_FADE_OUT_MS);
}

// Builds a per-layer symbol paint from the shared base (colour, halo, width). Only
// icon-opacity and its transition differ between layers — everything else is the same.
function makeLayerPaint(base, revealed, phase) {
  return {
    ...base,
    "icon-opacity": !revealed ? 0 : phase === "fading-out" ? 0 : 1,
    "icon-opacity-transition": {
      duration: !revealed
        ? 0
        : phase === "fading-out"
        ? FILTER_FADE_OUT_MS
        : phase === "fading-in"
        ? FILTER_FADE_IN_MS
        : REVEAL_MS,
    },
  };
}

function hexToRgb(hex) {
  const h = String(hex).replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return Number.isNaN(n) ? [136, 136, 136] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

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
  loading = false,
  exploreSeq = 0,
  onContextLost,
  // Hands the live MapLibre instance up to App, which lends its projection to the network
  // view — that projection is what lets the graph unfold out of the map and fold back into it.
  onMapReady,
  // Bumped by "Show on the map" in the detail drawer. A counter, not a node: asking twice for
  // the same institution must fly there twice.
  focusSeq = 0,
}) {
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  // Nodes stay hidden from the moment a new area is requested until the tiles are all in and
  // the camera is most of the way through its flight. Default true, so ordinary filter and
  // sector changes never trigger a fade — only a new area does.
  //
  // ONE BOOLEAN, and `icon-opacity` is a CONSTANT on both sides of it. That is not a style
  // choice, it is forced by MapLibre:
  //
  //   DataDrivenProperty.interpolate(a, b, t) {
  //       if (a.value.kind !== 'constant' || b.value.kind !== 'constant') return a;
  //
  // A transition between a constant and an EXPRESSION is not merely un-animated — going
  // expression → constant it keeps painting the OLD EXPRESSION for the whole duration and
  // then cuts; going constant → expression it snaps at once. So an icon-opacity that is
  // sometimes an expression and sometimes a number cannot be faded in either direction, and
  // it strands the previous value on screen for `duration` ms every time it changes kind.
  //
  // Hence: icon-opacity is *always* a plain number (0 → 1, which does interpolate), and all
  // the per-node alpha — the dim toggle, the pinned node's fan — rides the ALPHA CHANNEL of
  // `icon-color` / `icon-halo-color`, which are expressions permanently and so never change
  // kind. MapLibre multiplies colour alpha by icon-opacity in the SDF shader, so the two
  // compose exactly as the single expression used to.
  const [revealed, setRevealed] = useState(true);
  const revealTimer = useRef(null);
  const clearRevealTimers = () => {
    clearTimeout(revealTimer.current);
    revealTimer.current = null;
  };
  const [hoverNode, setHoverNode] = useState(null);
  // The popup outlives the hover (see the long note by `popupVisible`): it is kept mounted and
  // moved, rather than torn down and rebuilt, because a rebuilt MapLibre popup paints one
  // frame in the container's top-left corner before it is positioned.
  const [popupNode, setPopupNode] = useState(null);
  const [ready, setReady] = useState(false);
  // displayNodes: the GeoJSON source trails behind the `nodes` prop during filter transitions
  // so that nodes being removed participate in the fade-out rather than popping instantly.
  // Outside of filter transitions it is always equal to `nodes`.
  const [displayNodes, setDisplayNodes] = useState(nodes);
  const latestNodesRef = useRef(nodes);

  // Per-sector fade phases ("idle" | "fading-out" | "fading-in"). Each node layer is driven
  // independently so toggling one sector never disturbs the others.
  const [basicPhase, setBasicPhase] = useState("idle");
  const [higherPhase, setHigherPhase] = useState("idle");
  const [techvocPhase, setTechvocPhase] = useState("idle");
  const basicTimerRef = useRef(null);
  const higherTimerRef = useRef(null);
  const techvocTimerRef = useRef(null);
  const mapRef = useRef(null);
  const hoverFidRef = useRef(null);

  const nodeIndex = useMemo(() => {
    const m = {};
    for (const n of nodes) m[n.node_id] = n;
    return m;
  }, [nodes]);

  const nodesFC = useMemo(
    () => nodesGeoJSON(displayNodes, nearestIndex, thresholdKm, gapVisible, subcats, dimmed),
    [displayNodes, nearestIndex, thresholdKm, gapVisible, subcats, dimmed]
  );

  // Accessibility edges for the pinned node: everything within the threshold BY ROAD
  // that offers something it doesn't. Read from the precomputed adjacency in the tiles.
  const { fc: edgesFC, connectedIds } = useMemo(
    () => accessibilityEdges(selectedNode, nodes, thresholdKm, accessIndex),
    [selectedNode, nodes, thresholdKm, accessIndex]
  );

  const selId = selectedNode?.node_id || "";

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

  // Per-node alpha. Two independent kinds of de-emphasis, in priority order:
  //   1. a pinned selection fades everything not on its fan
  //   2. the user's per-subcategory "dim" pushes a level back without hiding it
  //
  // This rides the colour's ALPHA CHANNEL rather than icon-opacity — see `revealed`.
  const alphaExpr = useMemo(() => {
    const dimmedAlpha = 0.15;
    const base = ["case", ["get", "dim"], dimmedAlpha, NODE_ALPHA];
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

  // Sector colour, with the per-node alpha folded into it. `rgba` takes an expression per
  // channel, so this stays one data-driven value — never a constant, never a kind change.
  const colorExpr = useMemo(() => {
    const rgb = Object.fromEntries(SECTOR_KEYS.map((k) => [k, hexToRgb(sectorColors[k])]));
    const channel = (i) => [
      "match",
      ["get", "fill"],
      "public", rgb.public[i],
      "private", rgb.private[i],
      "hei_public", rgb.hei_public[i],
      "hei_private", rgb.hei_private[i],
      "tesda", rgb.tesda[i],
      136, // #888888
    ];
    return ["rgba", channel(0), channel(1), channel(2), alphaExpr];
  }, [sectorColors, alphaExpr]);

  // The old circle-stroke: white hairline normally, dark ring when pinned. Carries the same
  // alpha as the node, so a dimmed node's outline dims with it (icon-opacity used to do
  // that for both at once).
  const haloColorExpr = useMemo(() => {
    const isSel = ["==", ["get", "node_id"], selId];
    return [
      "rgba",
      ["case", isSel, SELECTED_HALO_RGB[0], 255],
      ["case", isSel, SELECTED_HALO_RGB[1], 255],
      ["case", isSel, SELECTED_HALO_RGB[2], 255],
      alphaExpr,
    ];
  }, [selId, alphaExpr]);

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

  // Per-sector reveal and filter fade. Each node layer gets its own paint so toggling one
  // sector does not alter the opacity of the others. The constant-on-both-sides constraint
  // on icon-opacity still applies (see the long note above `revealed`).
  //
  // icon-halo-width: widths MUST scale with nodeSize — see lib/nodeShapes.js for why fixed
  // pixel widths cause the halo-flood bug at the small end of the size slider.
  const symbolPaintBase = useMemo(
    () => ({
      "icon-color": colorExpr,
      "icon-halo-color": haloColorExpr,
      "icon-halo-width": [
        "case",
        ["==", ["get", "node_id"], selId], haloWidthSelectedFor(nodeSize + 4),
        haloWidthFor(nodeSize),
      ],
      "icon-halo-blur": 0,
    }),
    [colorExpr, haloColorExpr, selId, nodeSize]
  );
  const basicSymbolPaint = useMemo(
    () => makeLayerPaint(symbolPaintBase, revealed, basicPhase),
    [symbolPaintBase, revealed, basicPhase]
  );
  const higherSymbolPaint = useMemo(
    () => makeLayerPaint(symbolPaintBase, revealed, higherPhase),
    [symbolPaintBase, revealed, higherPhase]
  );
  const techvocSymbolPaint = useMemo(
    () => makeLayerPaint(symbolPaintBase, revealed, techvocPhase),
    [symbolPaintBase, revealed, techvocPhase]
  );

  const fitKey =
    Object.keys(tiles).sort().join(",") + "|" + [...activeSectors].sort().join(",");

  // A new area was requested — hide the nodes until they are ALL in, and drop any hover
  // state left over from the previous area. Without the clear, the popup for a node that
  // no longer exists keeps rendering at its old lng/lat — now far outside the view, which
  // MapLibre transforms to a large negative offset, i.e. it flashes in the TOP-LEFT corner.
  //
  // Derived DURING RENDER, not in an effect. An effect runs after the browser has painted,
  // so `setRevealed(false)` would need a second commit — and the first tiles of the new area
  // can already have landed and drawn by then, at full opacity. Measured: the nodes stayed
  // lit for ~140ms and a few dozen of them flashed up before the hide took hold. Setting
  // state during render of the *same* component makes React re-render before committing, so
  // the frame the user actually sees already has the nodes hidden.
  const [seenSeq, setSeenSeq] = useState(exploreSeq);
  if (exploreSeq !== seenSeq) {
    setSeenSeq(exploreSeq);
    clearRevealTimers();
    clearTimeout(basicTimerRef.current);
    clearTimeout(higherTimerRef.current);
    clearTimeout(techvocTimerRef.current);
    setBasicPhase("idle");
    setHigherPhase("idle");
    setTechvocPhase("idle");
    setRevealed(false);
    setHoverNode(null);
    setPopupNode(null);
    hoverFidRef.current = null;
  }

  // Fit, then reveal.
  //
  // `fitKey` changes as EACH tile arrives, so gating on `loading` is what stops the camera
  // re-fitting over and over while the area streams in: one flight, once everything is in.
  //
  // The fade starts when the CAMERA LANDS, not on a timer, and not when the data says it is
  // ready. `loading === false` only means the tile JSON has arrived; MapLibre then has to
  // parse it into buckets and run symbol placement for every institution, and that work
  // blocks the main thread. A fade that starts in the middle of it gets no frames: the whole
  // 450ms elapses inside one stalled frame and the tween lands as a single step, i.e. a pop.
  //
  // Neither of the obvious gates works, which is worth writing down:
  //   • `sourcedata` / isSourceLoaded("nodes") fires at ~8ms — the source reports "loaded"
  //     before setData has even been applied, so it is no gate at all.
  //   • `idle` fires 1–1.6s AFTER the camera lands, because it waits on every source,
  //     including the basemap's tiles from a CDN. It is hostage to the network.
  //
  // `moveend` on the 800ms flight is both: late enough that placement is done (measured: the
  // last symbols are placed ~780ms in) and early enough to be part of the same gesture, and
  // it depends on nothing but our own animation. The timer is only a safety net — the
  // institutions must NEVER be stranded invisible if the flight is interrupted.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || loading) return;
    const b = robustBounds(nodesFC.features);
    if (!b) return;
    map.fitBounds(b, { padding: 60, maxZoom: 14, duration: 800 });
    if (revealed) return;

    clearRevealTimers();
    const reveal = () => {
      clearRevealTimers();
      map.off("moveend", onLanded);
      setRevealed(true);
    };
    // One more frame after touchdown, so the tween never shares a frame with the last of the
    // placement work.
    function onLanded() {
      map.off("moveend", onLanded);
      requestAnimationFrame(() => requestAnimationFrame(reveal));
    }
    map.on("moveend", onLanded);
    revealTimer.current = setTimeout(reveal, 1800);
    return () => map.off("moveend", onLanded);
  }, [fitKey, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      clearRevealTimers();
      clearTimeout(basicTimerRef.current);
      clearTimeout(higherTimerRef.current);
      clearTimeout(techvocTimerRef.current);
    },
    []
  );

  // Keep latestNodesRef current. During non-reveal (area loading or pre-first-explore),
  // sync displayNodes immediately — filter fades only apply when the map is revealed.
  useEffect(() => {
    latestNodesRef.current = nodes;
    if (!revealed) setDisplayNodes(nodes);
  }, [nodes, revealed]); // eslint-disable-line react-hooks/exhaustive-deps

  // Per-sector filter fade: when subcats or activeSectors change while the map is revealed,
  // fade only the affected sector(s) out, defer the source update to the midpoint (so nodes
  // being removed participate in the fade-out), then fade the survivors back in.
  const prevSubcatsRef = useRef(subcats);
  const prevActiveSectorsRef = useRef(activeSectors);
  const isFirstFilterRef = useRef(true);
  useEffect(() => {
    if (isFirstFilterRef.current) {
      isFirstFilterRef.current = false;
      prevSubcatsRef.current = subcats;
      prevActiveSectorsRef.current = activeSectors;
      return;
    }
    const prevSub = prevSubcatsRef.current;
    const prevSec = prevActiveSectorsRef.current;
    prevSubcatsRef.current = subcats;
    prevActiveSectorsRef.current = activeSectors;
    if (!revealed) return;

    const ser = (s) => JSON.stringify([...(s || new Set())].sort());
    const basicChanged =
      prevSec.has("basic") !== activeSectors.has("basic") ||
      ser(prevSub.basic) !== ser(subcats.basic);
    const higherChanged =
      prevSec.has("higher") !== activeSectors.has("higher") ||
      ser(prevSub.higher) !== ser(subcats.higher);
    const techvocChanged =
      prevSec.has("techvoc") !== activeSectors.has("techvoc") ||
      ser(prevSub.techvoc) !== ser(subcats.techvoc);

    const syncDisplay = () => setDisplayNodes(latestNodesRef.current);
    if (basicChanged) startSectorFade(setBasicPhase, basicTimerRef, syncDisplay);
    if (higherChanged) startSectorFade(setHigherPhase, higherTimerRef, syncDisplay);
    if (techvocChanged) startSectorFade(setTechvocPhase, techvocTimerRef, syncDisplay);
  }, [subcats, activeSectors, revealed]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!map) return;
    if (typeof window !== "undefined") window.__ugnayMap = map; // probe hook
    onMapReady?.(map);
  }, [ready, onMapReady]);

  // "Show on the map", from the network view's detail drawer. Fires on a COUNTER, not on the
  // node, so asking for the same institution twice flies there twice — and so that it never
  // fires merely because the selection changed some other way (clicking a node on the map
  // must not yank the camera).
  const seenFocus = useRef(focusSeq);
  useEffect(() => {
    if (focusSeq === seenFocus.current) return;
    seenFocus.current = focusSeq;
    const map = mapRef.current?.getMap();
    if (!map || !selectedNode) return;
    if (!Number.isFinite(selectedNode.lon) || !Number.isFinite(selectedNode.lat)) return;
    map.flyTo({
      center: [selectedNode.lon, selectedNode.lat],
      zoom: Math.max(map.getZoom(), 14),
      duration: 900,
      essential: true,
    });
  }, [focusSeq, selectedNode]);

  // A lost WebGL context is the one failure that looks like a bug in *our* code but isn't:
  // the canvas freezes on its last frame, the map stops responding to drags and to the zoom
  // buttons, and any popup sticks at the container's origin (top-left) because MapLibre is
  // no longer transforming it — while the React chrome around it keeps working perfectly.
  // Only a reload fixes it. MapLibre does NOT recover on its own.
  //
  // The browser drops a context on a GPU driver reset, on memory pressure, or when a tab has
  // too many live contexts — none of which we control. So: ask for a restore, and if the
  // browser doesn't give one, tell App to remount the map with a fresh context. The tiles
  // are already in memory, so recovery costs a re-fit, not a re-download.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    const canvas = map?.getCanvas();
    if (!canvas) return;
    let restoreTimer = null;

    const onLost = (e) => {
      e.preventDefault(); // without this the context can never be restored
      console.warn("MAPLIBRE: WebGL context lost, attempting recovery");
      restoreTimer = setTimeout(() => onContextLost?.(), 1500);
    };
    const onRestored = () => {
      clearTimeout(restoreTimer);
      console.warn("MAPLIBRE: WebGL context restored");
      try {
        map.triggerRepaint();
      } catch {
        onContextLost?.(); // repaint on a half-dead map — remount instead
      }
    };

    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    return () => {
      clearTimeout(restoreTimer);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
    };
  }, [ready, onContextLost]);

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
      const clearHeight = box.clientHeight - sheetHeight();
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

  // A short grace before the hover card is dismissed.
  //
  // Sliding from one node to its neighbour ALWAYS crosses bare map, and a mousemove over bare
  // map has no features — so an instant dismissal tore the card down and rebuilt it between
  // every pair of dots. Ninety milliseconds is long enough to cross the gap and far too short
  // to feel sticky when you genuinely leave.
  const hoverOffRef = useRef(null);
  const cancelHoverOff = () => {
    clearTimeout(hoverOffRef.current);
    hoverOffRef.current = null;
  };

  const handleMouseMove = useCallback(
    (e) => {
      const map = mapRef.current?.getMap();
      if (!map) return;
      // Nothing is hoverable while the area is still being revealed. The institutions are held
      // at opacity 0 during the fade, but MapLibre still hit-tests them — so a cursor that
      // simply happened to be sitting over the map when the tiles landed (i.e. exactly where it
      // is right after you click "Explore map") would raise a hover card for a node that is not
      // on screen yet. Besides being wrong on its own, that was the trigger for a crash: it made
      // the popup's FIRST mount a visible one. See `popupClass`.
      if (!revealed) return;
      const f = e.features && e.features[0];
      if (hoverFidRef.current != null) {
        map.setFeatureState({ source: "nodes", id: hoverFidRef.current }, { hover: false });
        hoverFidRef.current = null;
      }
      if (f) {
        cancelHoverOff();
        map.getCanvas().style.cursor = "pointer";
        hoverFidRef.current = f.id;
        map.setFeatureState({ source: "nodes", id: f.id }, { hover: true });
        const n = nodeIndex[f.properties.node_id];
        setHoverNode((prev) => (prev?.node_id === n?.node_id ? prev : n || null));
      } else {
        map.getCanvas().style.cursor = "";
        if (!hoverOffRef.current) {
          hoverOffRef.current = setTimeout(() => {
            hoverOffRef.current = null;
            setHoverNode(null);
          }, 90);
        }
      }
    },
    [nodeIndex, revealed]
  );

  const handleMouseLeave = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (map && hoverFidRef.current != null) {
      map.setFeatureState({ source: "nodes", id: hoverFidRef.current }, { hover: false });
      hoverFidRef.current = null;
      map.getCanvas().style.cursor = "";
    }
    cancelHoverOff();
    setHoverNode(null);
  }, []);

  useEffect(() => () => clearTimeout(hoverOffRef.current), []);

  const NODE_LAYERS = ["nodes-basic", "nodes-higher", "nodes-techvoc"];
  // Don't double up: while a node is pinned, don't also hover-card it. And never render a
  // popup for a node that has left the current area, or for one with a bad coordinate —
  // MapLibre throws on an invalid LngLat, and a throw inside its update path can take the
  // whole render loop down with it (a frozen, undraggable map).
  const showHover = Boolean(
    hoverNode &&
      hoverNode.node_id !== selId &&
      nodeIndex[hoverNode.node_id] &&
      Number.isFinite(hoverNode.lon) &&
      Number.isFinite(hoverNode.lat)
  );

  // THE POPUP IS MOUNTED ONCE AND ONLY EVER MOVED. It is never created on hover.
  //
  // It used to be `{showHover && <Popup/>}`, so every node built a brand-new MapLibre popup.
  // A freshly added popup is NOT positioned in the same frame it is added: MapLibre defers
  // popup DOM writes onto its render-task queue, so for the first frame or several the element
  // sits at its untransformed origin — the container's TOP-LEFT CORNER — and only then jumps
  // to the node. Hovering across a row of schools flashed a white card up there over and over.
  //
  // Delaying the reveal by a frame did NOT fix it (measured: `transform: matrix(1,0,0,1,0,3)`
  // — i.e. still unpositioned — six frames into the fade). Any time-based reveal is racing a
  // queue whose flush we do not control.
  //
  // So don't race it. The popup mounts as soon as the map has ANY institution, parked on one
  // and invisible; its unpositioned frames happen there, at load, where nothing is on screen to
  // flash. From then on hovering only ever calls setLngLat, which moves an already-positioned
  // element from one valid place to another. There is no frame at which it can be in the corner
  // and visible, because there is no frame at which it is created and visible.
  useEffect(() => {
    if (showHover) setPopupNode(hoverNode);
  }, [showHover, hoverNode]);

  // …but NOT during the reveal. Creating a MapLibre popup and rendering a card into it is main-
  // thread work, and the reveal is a 450ms tween that is already tight enough to fail on a
  // software renderer (T2.4). Mounting the popup the instant the tiles land put that work
  // squarely inside the fade. Waiting for `revealed` costs nothing — the popup only has to
  // exist before the first HOVER, which is hundreds of milliseconds later — and it keeps the
  // fix for the corner flash from being paid for out of the reveal's frame budget.
  // The popup must NEVER unmount once it has first appeared. Unmounting and remounting
  // causes MapLibre to create a new popup DOM element which starts at (0,0) — the
  // top-left corner — for one frame before the library positions it. That is the flash.
  // Keep it parked on any valid node; visibility is controlled entirely by the --off class.
  // We do NOT gate on `revealed` here: the popup should be parked (at opacity 0, invisible)
  // as early as nodes are available so the reveal animation gets no extra DOM work.
  // lastAnchorRef: once the popup has been parked on any valid node it NEVER goes back to
  // null. The popup's first mount at opacity 0 is the one allowed (0,0)-frame; after that
  // every area change leaves the popup mounted and parked at the last known position (hidden
  // by --off), so there is no remount and no further corner flash.
  const lastAnchorRef = useRef(null);
  const popupAnchor = useMemo(() => {
    const candidate =
      popupNode || nodes.find((n) => Number.isFinite(n.lon) && Number.isFinite(n.lat)) || null;
    if (candidate) lastAnchorRef.current = candidate;
    return lastAnchorRef.current;
  }, [popupNode, nodes]);

  const popupVisible = showHover && !!popupNode;

  // BUILT BY JOINING, NEVER BY INTERPOLATING AN EMPTY STRING. This is not style.
  //
  // MapLibre applies a popup's className like this, with no filter:
  //
  //     for (const t of this.options.className.split(" "))
  //         this._container.classList.add(t);
  //
  // so ONE trailing space produces an empty token, and `classList.add("")` throws
  // "Failed to execute 'add' on 'DOMTokenList': The token provided must not be empty."
  // The old template — `ugnay-popup ugnay-popup--hover ${visible ? "" : "--off"}` — left
  // exactly that trailing space whenever the card was visible.
  //
  // It only ever detonated if the popup's FIRST mount was a visible one, which is why it looked
  // random: it needed the cursor to be sitting over the map as a new area landed (i.e. exactly
  // where the cursor is right after you press "Explore map"), so that a hover — not the anchor —
  // was what first brought the popup into existence. It took down the whole map view, and the
  // ErrorBoundary caught it, so it never even surfaced as a console error.
  const popupClass = ["ugnay-popup", "ugnay-popup--hover", popupVisible ? null : "ugnay-popup--off"]
    .filter(Boolean)
    .join(" ");

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
            // The halo spans all sectors, so it uses a combined phase: if any sector is
            // fading, the halo fades with it. Without this the ring stays visible while its
            // node disappears, which looks like a stray coloured circle.
            "circle-stroke-opacity": !revealed
              ? 0
              : basicPhase === "fading-out" ||
                higherPhase === "fading-out" ||
                techvocPhase === "fading-out"
              ? 0
              : 0.9,
            "circle-stroke-opacity-transition": {
              duration: !revealed
                ? 0
                : basicPhase === "fading-out" ||
                  higherPhase === "fading-out" ||
                  techvocPhase === "fading-out"
                ? FILTER_FADE_OUT_MS
                : basicPhase === "fading-in" ||
                  higherPhase === "fading-in" ||
                  techvocPhase === "fading-in"
                ? FILTER_FADE_IN_MS
                : REVEAL_MS,
            },
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
          paint={basicSymbolPaint}
        />
        <Layer
          id="nodes-higher"
          type="symbol"
          filter={["==", ["get", "source"], "hei"]}
          layout={symbolLayout}
          paint={higherSymbolPaint}
        />
        <Layer
          id="nodes-techvoc"
          type="symbol"
          filter={["==", ["get", "source"], "tesda"]}
          layout={symbolLayout}
          paint={techvocSymbolPaint}
        />
      </Source>

      {/* Hover: transient card, no close button. Mounted once and then MOVED — never
          re-created — see the note above `popupAnchor`. */}
      {popupAnchor && (
        <Popup
          longitude={popupAnchor.lon}
          latitude={popupAnchor.lat}
          closeButton={false}
          closeOnClick={false}
          anchor="bottom"
          offset={14}
          maxWidth="none"
          className={popupClass}
        >
          <InstitutionCard
            node={popupAnchor}
            colors={sectorColors}
            place={places[popupAnchor.node_id]}
          />
        </Popup>
      )}

      {/* NOTE: there is deliberately NO pinned popup. Detail for the clicked institution
          lives in the side drawer — a popup anchored to the node always covered part of
          its own edge fan, and edges radiate in every direction, so no anchor is safe. */}
    </Map>
  );
}
