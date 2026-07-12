import InstitutionCard from "./InstitutionCard";
import { LEVELS } from "../lib/stats";
import { SECTOR_LABEL } from "../lib/graph";

// Detail for the PINNED institution.
//
// Lives OFF the map on purpose: a popup anchored to the node always covered part of its
// own edge fan, and edges radiate in every direction, so no anchor or offset is safe.
//
// It OVERLAYS the map and slides in on `transform` — it must never change the map
// container's size. Animating the width made the container shrink frame by frame; every
// one of those resizes reallocates (and therefore clears) MapLibre's WebGL drawing
// buffer, which is what made the map flash white on each click. A transform is composited
// off the main thread and touches no layout, so the map underneath is left untouched.
// MapView pans the map only if the drawer would land on top of the node you just clicked.

function Ladder({ stats, colors }) {
  // Drawn top-down, so reverse: the institution's own rung sits at the bottom, and the
  // levels it can progress INTO stack above it. That vertical reading is the whole point.
  const rows = [...LEVELS].reverse();
  return (
    <div className="space-y-1">
      {rows.map((lvl) => {
        const isOwn = stats.own.has(lvl.key);
        const isNext = stats.nextSteps.has(lvl.key);
        const n = stats.counts[lvl.key];
        const near = stats.nearest[lvl.key];

        if (isOwn) {
          return (
            <div key={lvl.key} className="flex items-center gap-2 pt-1">
              <span className="text-[11px] font-semibold text-gray-700 w-[92px] shrink-0 text-right">
                {lvl.label}
              </span>
              <span className="flex-1 flex items-center gap-1.5">
                <span className="h-px flex-1 bg-gray-300" />
                <span className="text-[9px] uppercase tracking-wide text-gray-400">you are here</span>
                <span className="h-px flex-1 bg-gray-300" />
              </span>
            </div>
          );
        }

        const pct = Math.round((n / stats.maxCount) * 100);
        return (
          <div key={lvl.key} className="flex items-center gap-2">
            <span
              className={`text-[11px] w-[92px] shrink-0 text-right ${
                isNext ? "font-semibold text-gray-800" : "text-gray-500"
              }`}
            >
              {lvl.label}
            </span>
            <div className="flex-1 h-3 bg-gray-100 rounded-sm overflow-hidden">
              <div
                className="h-full rounded-sm transition-[width] duration-500 ease-out"
                style={{
                  width: `${n ? Math.max(pct, 4) : 0}%`,
                  backgroundColor: isNext ? "#334155" : "#cbd5e1",
                }}
              />
            </div>
            <span
              className={`text-[11px] w-5 text-right tabular-nums ${
                n ? "text-gray-700" : "text-gray-300"
              }`}
            >
              {n}
            </span>
            {isNext && (
              <span className="text-[9px] text-gray-400 whitespace-nowrap">
                {near != null ? `${near.toFixed(1)} km` : "—"}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function DetailDrawer({
  node,
  place,
  colors,
  stats,
  thresholdKm,
  onClose,
  isMobile = false,
}) {
  const hasStats = stats && node;

  // Desktop: a right-hand drawer that slides in horizontally. Mobile: a BOTTOM sheet that
  // slides up — an 18rem side drawer on a 390px screen would leave a 100px slit of map.
  // Both slide on a TRANSFORM and overlay the map; neither resizes it, because resizing
  // the map container reallocates MapLibre's WebGL buffer and flashes it white.
  const shell = isMobile
    ? `inset-x-0 bottom-0 h-[60dvh] rounded-t-2xl border-t shadow-[0_-6px_20px_-10px_rgba(15,23,42,0.25)] ${
        node ? "translate-y-0" : "translate-y-full pointer-events-none"
      }`
    : `inset-y-0 right-0 w-72 border-l shadow-[-6px_0_20px_-10px_rgba(15,23,42,0.25)] ${
        node ? "translate-x-0" : "translate-x-full pointer-events-none"
      }`;

  return (
    <aside
      aria-hidden={!node}
      // `aria-hidden` on a container that still holds a focusable control (the ✕) is an
      // ARIA violation: a keyboard user tabs into a panel that, to them, isn't there.
      // `inert` takes it out of the tab order and the a11y tree together.
      inert={!node}
      className={`absolute z-30 flex flex-col bg-white border-gray-200
        transition-transform duration-300 ease-out will-change-transform ${shell}`}
    >
      {isMobile && (
        <div className="flex justify-center pt-2 pb-1 shrink-0">
          <span className="w-9 h-1 rounded-full bg-gray-300" />
        </div>
      )}
      <div className={`h-full flex flex-col ${isMobile ? "w-full" : "w-72"}`}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 shrink-0">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Institution
          </span>
          <button
            onClick={onClose}
            title="Close"
            className="w-6 h-6 flex items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            ✕
          </button>
        </div>

        <div className="px-3 py-3 overflow-y-auto">
          {node && <InstitutionCard node={node} colors={colors} place={place} />}

          {hasStats && (
            <>
              {/* Pathway ladder — the subtle progression cue */}
              <div className="mt-4 pt-3 border-t border-gray-100">
                <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-2">
                  Reachable within {thresholdKm} km by road
                </div>
                <Ladder stats={stats} colors={colors} />
              </div>

              {/* Gap status — explains the halo the user can see on the map */}
              {stats.gap && (
                <div
                  className={`mt-3 rounded-md px-2.5 py-2 text-[11px] leading-snug ring-1 ${
                    stats.gap.tone === "red"
                      ? "bg-red-50 text-red-700 ring-red-100"
                      : "bg-amber-50 text-amber-800 ring-amber-100"
                  }`}
                >
                  {stats.gap.text}
                </div>
              )}

              {/* Sector breakdown of the reachable set */}
              {stats.total > 0 && (
                <div className="mt-4 pt-3 border-t border-gray-100">
                  <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1.5">
                    What’s reachable
                  </div>
                  <div className="space-y-1">
                    {Object.entries(stats.sectors)
                      .sort((a, b) => b[1] - a[1])
                      .map(([k, n]) => (
                        <div key={k} className="flex items-center gap-2 text-[11px] text-gray-600">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: colors[k] }}
                          />
                          <span className="flex-1 truncate">{SECTOR_LABEL[k]}</span>
                          <span className="tabular-nums text-gray-700">{n}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Nearest of each level, at any distance */}
              <div className="mt-4 pt-3 border-t border-gray-100">
                <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1.5">
                  Nearest of each level
                </div>
                <div className="space-y-0.5">
                  {LEVELS.filter((l) => !stats.own.has(l.key)).map((l) => {
                    const d = stats.nearest[l.key];
                    return (
                      <div key={l.key} className="flex items-baseline gap-2 text-[11px]">
                        <span className="flex-1 text-gray-500 truncate">{l.label}</span>
                        <span
                          className={`tabular-nums ${
                            d == null
                              ? "text-gray-300"
                              : d <= thresholdKm
                                ? "text-gray-800 font-medium"
                                : "text-gray-400"
                          }`}
                        >
                          {d == null ? "—" : `${d.toFixed(1)} km`}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] text-gray-400 leading-snug mt-2">
                  Routed road distance (OSRM), nearest anywhere in the country — not limited
                  to the area you have loaded. “—” means none reachable by road.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
