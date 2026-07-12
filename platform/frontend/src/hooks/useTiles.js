import { useState, useCallback, useRef } from "react";

const TILES_BASE = "/tiles";

export function useTiles() {
  const [adminIndex, setAdminIndex] = useState(null);
  const [loadedTiles, setLoadedTiles] = useState({});
  const [loadingSet, setLoadingSet] = useState(new Set());
  const [indexLoading, setIndexLoading] = useState(false);
  const cache = useRef({});

  const loadAdminIndex = useCallback(async () => {
    setIndexLoading(true);
    try {
      const res = await fetch(`${TILES_BASE}/admin_index.json`);
      const data = await res.json();
      setAdminIndex(data);
    } finally {
      setIndexLoading(false);
    }
  }, []);

  const loadTile = useCallback(async (municityPsgc) => {
    if (cache.current[municityPsgc]) {
      setLoadedTiles((prev) => ({ ...prev, [municityPsgc]: cache.current[municityPsgc] }));
      return cache.current[municityPsgc];
    }
    setLoadingSet((prev) => new Set([...prev, municityPsgc]));
    try {
      const res = await fetch(`${TILES_BASE}/${municityPsgc}.json`);
      if (!res.ok) throw new Error(`Tile not found: ${municityPsgc}`);
      const data = await res.json();
      cache.current[municityPsgc] = data;
      setLoadedTiles((prev) => ({ ...prev, [municityPsgc]: data }));
      return data;
    } catch (err) {
      console.error("Tile load error:", err);
      return null;
    } finally {
      setLoadingSet((prev) => {
        const next = new Set(prev);
        next.delete(municityPsgc);
        return next;
      });
    }
  }, []);

  const evictTile = useCallback((municityPsgc) => {
    setLoadedTiles((prev) => {
      const next = { ...prev };
      delete next[municityPsgc];
      return next;
    });
    delete cache.current[municityPsgc];
  }, []);

  const evictAll = useCallback(() => {
    setLoadedTiles({});
    cache.current = {};
  }, []);

  return {
    adminIndex,
    loadedTiles,
    isLoadingIndex: indexLoading,
    isLoadingTile: (p) => loadingSet.has(p),
    loadAdminIndex,
    loadTile,
    evictTile,
    evictAll,
  };
}
