import { useEffect, useState, useMemo } from "react";

// Administrative borders — a quiet visual guide, not a data layer.
//
// Level follows what the user is looking at:
//   region / one-or-more whole provinces  → PROVINCE borders
//   specific cities/municipalities picked → MUNICIPALITY borders
//
// Matching is by PCODE, never by name: HDX pcodes are "PH" + the PSGC digits, so
// ADM3_PCODE "PH0102801" → municity key "0102801", and ADM2_PCODE "PH01028" → the
// province = first 5 digits of that key. Name-matching would break on the same casing
// and NCR quirks that S6 had to canonicalise.
const FILES = {
  provincial: "/boundaries/provincial_boundaries.geojson",
  municipal: "/boundaries/municipal_boundaries.geojson",
};

const EMPTY = { type: "FeatureCollection", features: [] };
const cache = {};

export function useBoundaries(level, municityKeys) {
  const [raw, setRaw] = useState(null);

  useEffect(() => {
    if (!level) return;
    let cancelled = false;
    if (cache[level]) {
      setRaw(cache[level]);
      return;
    }
    fetch(FILES[level])
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || cancelled) return;
        cache[level] = d;
        setRaw(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [level]);

  return useMemo(() => {
    if (!raw || !municityKeys?.length) return EMPTY;
    const keys = new Set(municityKeys);
    if (level === "municipal") {
      return {
        type: "FeatureCollection",
        features: raw.features.filter((f) =>
          keys.has(String(f.properties.ADM3_PCODE || "").slice(2))
        ),
      };
    }
    const provinces = new Set([...keys].map((k) => k.slice(0, 5)));
    return {
      type: "FeatureCollection",
      features: raw.features.filter((f) =>
        provinces.has(String(f.properties.ADM2_PCODE || "").slice(2))
      ),
    };
  }, [raw, level, municityKeys]);
}
