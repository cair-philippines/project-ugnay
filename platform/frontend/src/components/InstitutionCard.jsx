import { SECTOR_LABEL, fillKey } from "../lib/graph";

// Chips describing what the institution actually offers — the most defining attribute
// after its name.
function offerings(n) {
  if (n.source === "public" || n.source === "private") {
    const out = [];
    if (n.offers_es) out.push("Elementary");
    if (n.offers_jhs) out.push("Junior High");
    if (n.offers_shs) out.push("Senior High");
    return out;
  }
  if (n.source === "hei") {
    // hei_sector is the raw CHED value (SUC / LUC / Private HEI …)
    return n.hei_sector ? [n.hei_sector] : [n.hei_is_public ? "Public" : "Private"];
  }
  if (n.source === "tesda") {
    const out = [];
    if (n.tesda_role_provider) out.push("Training provider");
    if (n.tesda_role_assessment) out.push("Assessment center");
    return out;
  }
  return [];
}

// Government subsidy programs — only meaningful on private schools, so we don't clutter
// ~48k public-school cards with three empty rows.
function programs(n) {
  if (n.source !== "private") return [];
  const out = [];
  if (n.esc_participating) out.push("ESC");
  if (n.shsvp_participating) out.push("SHS VP");
  if (n.jdvp_participating) out.push("JDVP");
  return out;
}

function Chip({ children, tone = "gray" }) {
  const tones = {
    gray: "bg-gray-100 text-gray-600",
    green: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
  };
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] leading-none ${tones[tone]}`}>
      {children}
    </span>
  );
}

// `pinned` cards carry MapLibre's close button in the top-right corner. Reserve a
// gutter on the TITLE ROW ONLY (not the whole card) so long institution names wrap
// clear of the "×" instead of running underneath it.
export default function InstitutionCard({ node, colors, place, pinned = false }) {
  if (!node) return null;
  const key = fillKey(node);
  const color = colors[key];
  const offers = offerings(node);
  const progs = programs(node);
  // In NCR the "province" slot holds the city name (S6 convention), so municipality and
  // province are identical — don't print "City of Malabon, City of Malabon".
  const locality = [...new Set([place?.municipality, place?.province].filter(Boolean))].join(", ");

  return (
    <div className="w-[232px]">
      {/* Header: colour rail + name + sector */}
      <div className="flex items-start gap-2">
        <span
          className="mt-[3px] w-2.5 h-2.5 rounded-full shrink-0 ring-2 ring-white shadow-sm"
          style={{ backgroundColor: color }}
        />
        <div className="min-w-0">
          <div
            className={`font-semibold text-[13px] leading-snug text-gray-900 break-words ${
              pinned ? "pr-5" : ""
            }`}
          >
            {node.name || "Unnamed institution"}
          </div>
          <div className="text-[11px] font-medium mt-0.5" style={{ color }}>
            {SECTOR_LABEL[key]}
          </div>
        </div>
      </div>

      {offers.length > 0 && (
        <div className="mt-2.5">
          <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Offers</div>
          <div className="flex flex-wrap gap-1">
            {offers.map((o) => (
              <Chip key={o}>{o}</Chip>
            ))}
          </div>
        </div>
      )}

      {progs.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Programs</div>
          <div className="flex flex-wrap gap-1">
            {progs.map((p) => (
              <Chip key={p} tone="green">
                {p}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {(locality || node.source_vintage) && (
        <div className="mt-2.5 pt-2 border-t border-gray-100 text-[11px] text-gray-500 space-y-0.5">
          {locality && <div>{locality}</div>}
          {node.source_vintage && <div className="text-gray-400">{node.source_vintage}</div>}
        </div>
      )}
    </div>
  );
}
