// Tiny single-value TTL cache. Used to keep the polled real-time dashboard fast
// (STORY-021): recomputing cross-channel aggregates on every poll is wasteful,
// so results are memoized for a short window and invalidated when data changes.

export function createTTLCache(ttlMs) {
  let entry = null; // { at, value }
  return {
    get(compute) {
      const now = Date.now();
      if (entry && now - entry.at < ttlMs) return { value: entry.value, hit: true };
      const value = compute();
      entry = { at: now, value };
      return { value, hit: false };
    },
    invalidate() {
      entry = null;
    },
  };
}
