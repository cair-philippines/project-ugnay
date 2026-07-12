// The legend and the shape picker must show the SAME mark the map draws, or the legend
// lies. One SVG, driven by the same (shape, colour) pair the map's icon expression uses.
//
// Geometry mirrors lib/nodeShapes.js — equal visual weight, not equal width — on a 24×24
// viewBox: circle r=10, square half-side 8.5, diamond L1 radius 11.5, triangle
// circumradius 12 nudged down so its centroid sits at the centre.
export default function ShapeMark({ shape = "circle", color = "#888", size = 12, className = "" }) {
  const common = { fill: color };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      {shape === "circle" && <circle cx="12" cy="12" r="10" {...common} />}
      {shape === "square" && <rect x="3.5" y="3.5" width="17" height="17" rx="1.5" {...common} />}
      {shape === "diamond" && <polygon points="12,0.5 23.5,12 12,23.5 0.5,12" {...common} />}
      {shape === "triangle" && <polygon points="12,1.5 22.4,19.5 1.6,19.5" {...common} />}
    </svg>
  );
}
