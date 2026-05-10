import type { BookAvailability } from "~/lib/libby";
import { IdbCache } from "~/lib/idb-cache";

const LEGACY_KEY = "shelfcheck:availability";
const AVAILABLE_NOW_CACHE_MS = 1 * 60 * 60 * 1000; // 1 hour — available books can disappear
const MIN_CACHE_MS = 2 * 60 * 60 * 1000; // 2 hours
const DEFAULT_CACHE_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedEntry {
  data: BookAvailability;
  fetchedAt: number;
}

const cache = new IdbCache<CachedEntry>({
  // Each IdbCache opens its own IDB database to avoid two caches racing on
  // a shared schema upgrade. We don't share a database across caches because
  // there is no coordination layer to declare both stores at the same
  // version.
  dbName: "shelfcheck-availability",
  storeName: "entries",
  legacyLocalStorageKey: LEGACY_KEY,
  // 5000 books per user is well past any realistic reading list while still
  // capping IDB usage at ~50 MB worst-case per book payload.
  maxEntries: 5000,
});

/** Resolves once the IDB-backed cache has finished its initial load. */
export function whenAvailabilityCacheReady(): Promise<void> {
  return cache.whenHydrated();
}

export function readCache(): Record<string, CachedEntry> {
  const out: Record<string, CachedEntry> = {};
  for (const [key, value] of cache.entries()) out[key] = value;
  return out;
}

export function cacheMaxAge(entry: CachedEntry): number {
  if (entry.data.results.length === 0) {
    return DEFAULT_CACHE_MS;
  }

  // If any result is available now, use a short TTL — available copies can
  // be checked out at any time, so we want to detect that quickly.
  const hasAvailableNow = entry.data.results.some((r) => r.availability.isAvailable);
  if (hasAvailableNow) {
    return AVAILABLE_NOW_CACHE_MS;
  }

  // Find the shortest estimated wait across all results
  let minWaitDays: number | null = null;
  for (const r of entry.data.results) {
    const days = r.availability.estimatedWaitDays;
    if (days != null && (minWaitDays === null || days < minWaitDays)) {
      minWaitDays = days;
    }
  }

  if (minWaitDays == null) {
    return DEFAULT_CACHE_MS;
  }

  // Half-life of the shortest wait, minimum 2 hours
  const halfLifeMs = (minWaitDays / 2) * 24 * 60 * 60 * 1000;
  return Math.max(halfLifeMs, MIN_CACHE_MS);
}

export function getCached(bookId: string): CachedEntry | null {
  const entry = cache.get(bookId);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > cacheMaxAge(entry)) return null;
  return entry;
}

export function setCached(bookId: string, data: BookAvailability) {
  cache.set(bookId, { data, fetchedAt: Date.now() });
}

/** Test-only: drop the in-memory and persisted caches between cases. */
export function __resetAvailabilityCacheForTest(): Promise<void> {
  return cache.__resetForTest();
}

/** Test-only: backdate an entry's fetchedAt without round-tripping IDB. */
export function __backdateAvailabilityForTest(bookId: string, fetchedAt: number): void {
  cache.__backdateForTest(bookId, fetchedAt);
}
