import { useMemo } from "react";

const TRANSITION_LABELS = {
  ES_JHS:           "ES → JHS",
  JHS_SHS:          "JHS → SHS",
  SHS_HEI:          "SHS → HEI",
  SHS_TESDA_prov:   "SHS → TESDA",
  HEI_TESDA_prov:   "HEI → TESDA",
  TESDA_prov_assess:"TESDA Prov → Assess",
};

const BAND_LABEL_STYLE = {
  most: "bg-green-100 text-green-800 font-semibold",
  many: "bg-yellow-100 text-yellow-800 font-semibold",
  few:  "bg-orange-100 text-orange-800 font-semibold",
  none: "bg-red-100 text-red-800 font-semibold",
};

const BANDS = [1, 2, 3, 4, 5];
const TRANSITIONS = Object.keys(TRANSITION_LABELS);

function BandCell({ stat }) {
  if (!stat) return <td className="text-center text-gray-300 py-1 px-2 text-xs">—</td>;
  const cls = BAND_LABEL_STYLE[stat.band_label] || "bg-gray-100 text-gray-700";
  return (
    <td className="text-center py-1 px-2">
      <span className={`text-xs rounded px-1.5 py-0.5 ${cls}`}>
        {stat.band_label}
      </span>
      <div className="text-gray-400 text-xs">{stat.continuity_pct}%</div>
    </td>
  );
}

function MunicipalityBlock({ tile }) {
  const continuity = tile.continuity || {};
  return (
    <div className="mb-4">
      <div className="font-semibold text-sm text-gray-700 mb-1">
        {tile.meta.municipality}
        <span className="ml-2 text-xs font-normal text-gray-400">
          {tile.meta.province}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-1 px-2 text-gray-500 font-medium">Transition</th>
              {BANDS.map((b) => (
                <th key={b} className="text-center py-1 px-2 text-gray-500 font-medium">
                  {b} km
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TRANSITIONS.map((t) => {
              const row = continuity[t];
              if (!row) return null;
              return (
                <tr key={t} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-1 px-2 text-gray-700 whitespace-nowrap">
                    {TRANSITION_LABELS[t]}
                  </td>
                  {BANDS.map((b) => (
                    <BandCell key={b} stat={row[String(b)]} />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NodeDetail({ node }) {
  if (!node) return null;
  const sectorColor = {
    public:  "bg-blue-100 text-blue-800",
    private: "bg-orange-100 text-orange-800",
    hei:     "bg-green-100 text-green-800",
    tesda:   "bg-purple-100 text-purple-800",
  }[node.source] || "bg-gray-100 text-gray-800";

  const levels = [
    node.offers_es  && "ES",
    node.offers_jhs && "JHS",
    node.offers_shs && "SHS",
    node.source === "hei"   && "HEI",
    node.tesda_role_provider   && "TESDA Provider",
    node.tesda_role_assessment && "TESDA Assessment",
  ].filter(Boolean);

  return (
    <div className="border-t border-gray-200 pt-3 mt-3">
      <div className="font-semibold text-sm text-gray-800 mb-1">{node.name}</div>
      <div className="flex flex-wrap gap-1 mb-2">
        <span className={`text-xs rounded px-1.5 py-0.5 ${sectorColor}`}>
          {node.source}
        </span>
        {levels.map((l) => (
          <span key={l} className="text-xs rounded px-1.5 py-0.5 bg-gray-100 text-gray-700">
            {l}
          </span>
        ))}
      </div>
      {node.esc_participating && (
        <div className="text-xs text-blue-700">✓ ESC participating</div>
      )}
      {node.shsvp_participating && (
        <div className="text-xs text-blue-700">✓ SHSVP participating</div>
      )}
      <div className="text-xs text-gray-400 mt-1">
        {node.lat?.toFixed(5)}, {node.lon?.toFixed(5)}
      </div>
    </div>
  );
}

export default function ContinuityPanel({ tiles, selectedNode }) {
  const tileList = useMemo(() => Object.values(tiles || {}), [tiles]);

  if (tileList.length === 0 && !selectedNode) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm text-center px-4">
        Select a municipality to see pathway continuity and institutions.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4">
      {selectedNode && <NodeDetail node={selectedNode} />}
      {tileList.length > 0 && (
        <>
          <h3 className="font-semibold text-sm text-gray-600 uppercase tracking-wide mb-3 mt-3">
            Pathway Continuity
          </h3>
          <div className="text-xs text-gray-400 mb-2 flex gap-4">
            <span className="flex items-center gap-1">
              <span className="bg-green-100 text-green-800 rounded px-1">most</span> ≥75%
            </span>
            <span className="flex items-center gap-1">
              <span className="bg-yellow-100 text-yellow-800 rounded px-1">many</span> 40-74%
            </span>
            <span className="flex items-center gap-1">
              <span className="bg-orange-100 text-orange-800 rounded px-1">few</span> 1-39%
            </span>
            <span className="flex items-center gap-1">
              <span className="bg-red-100 text-red-800 rounded px-1">none</span> 0%
            </span>
          </div>
          {tileList.map((tile) => (
            <MunicipalityBlock key={tile.meta.municity_psgc} tile={tile} />
          ))}
        </>
      )}
    </div>
  );
}
