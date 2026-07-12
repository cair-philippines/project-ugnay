import { useMemo } from "react";

// Maps an adminIndex region entry to a flat province list
function getProvincesForRegion(adminIndex, regionName) {
  if (!adminIndex) return [];
  const entry = adminIndex.regions.find((r) => r.region === regionName);
  return entry ? entry.provinces : [];
}

function getMunicipalitiesForProvince(adminIndex, regionName, provinceName) {
  const provinces = getProvincesForRegion(adminIndex, regionName);
  const entry = provinces.find((p) => p.province === provinceName);
  return entry ? entry.municipalities : [];
}

export default function GeoPicker({
  adminIndex,
  selectedRegion,
  selectedProvinces,
  selectedMunicipalities,
  onRegionChange,
  onProvinceToggle,
  onSelectAllProvinces,
  onClearProvinces,
  onMunicipalityToggle,
}) {
  const regions = useMemo(() => {
    if (!adminIndex) return [];
    return adminIndex.regions.map((r) => r.region);
  }, [adminIndex]);

  const provinces = useMemo(
    () => getProvincesForRegion(adminIndex, selectedRegion),
    [adminIndex, selectedRegion]
  );

  const municipalities = useMemo(() => {
    if (selectedProvinces.length !== 1) return [];
    return getMunicipalitiesForProvince(adminIndex, selectedRegion, selectedProvinces[0]);
  }, [adminIndex, selectedRegion, selectedProvinces]);

  const isMultiProvince = selectedProvinces.length > 1;
  const isMunicipalPickerActive = selectedProvinces.length === 1;

  return (
    <div className="flex flex-col gap-3">
      {/* Region */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          Region
        </label>
        <select
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
          value={selectedRegion || ""}
          onChange={(e) => onRegionChange(e.target.value || null)}
        >
          <option value="">— select region —</option>
          {regions.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>

      {/* Provinces (multi-select checkboxes) */}
      {selectedRegion && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Province(s)
              {isMultiProvince && (
                <span className="ml-2 text-xs font-normal text-blue-600 normal-case">
                  Provincial view
                </span>
              )}
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onSelectAllProvinces}
                className="text-xs text-blue-600 hover:underline normal-case"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={onClearProvinces}
                className="text-xs text-gray-400 hover:underline normal-case"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-md p-2 space-y-1 bg-white">
            {provinces.map((p) => {
              const checked = selectedProvinces.includes(p.province);
              return (
                <label
                  key={p.province}
                  className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onProvinceToggle(p.province)}
                    className="accent-blue-500"
                  />
                  <span>{p.province}</span>
                </label>
              );
            })}
            {provinces.length === 0 && (
              <p className="text-xs text-gray-400 italic">No provinces</p>
            )}
          </div>
        </div>
      )}

      {/* Municipalities (only when single province) */}
      {isMunicipalPickerActive && (
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Municipality / City
            <span className="ml-2 text-xs font-normal text-gray-400 normal-case">
              none selected = all
            </span>
          </label>
          <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-md p-2 space-y-1 bg-white">
            {municipalities.map((m) => {
              const checked = selectedMunicipalities.includes(m.municity_psgc);
              return (
                <label
                  key={m.municity_psgc}
                  className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onMunicipalityToggle(m.municity_psgc)}
                    className="accent-blue-500"
                  />
                  <span>{m.name}</span>
                </label>
              );
            })}
            {municipalities.length === 0 && (
              <p className="text-xs text-gray-400 italic">No municipalities found</p>
            )}
          </div>
        </div>
      )}

      {selectedRegion && (
        <p className="text-xs text-gray-500 bg-blue-50 rounded px-2 py-1">
          All provinces are selected by default (province-wide view). Choose{" "}
          <span className="font-semibold">exactly one province</span> to drill down to specific
          cities/municipalities.
        </p>
      )}
    </div>
  );
}
