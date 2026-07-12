import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// REQUIRED. Without this stylesheet the map canvas still draws, but every maplibre
// DOM overlay is unstyled: .maplibregl-popup loses `position:absolute` and is laid out
// as a static block inside the map container, collapsing the canvas — the map goes
// white the moment a popup opens. NavigationControl (zoom +/-) is invisible too.
import "maplibre-gl/dist/maplibre-gl.css";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
