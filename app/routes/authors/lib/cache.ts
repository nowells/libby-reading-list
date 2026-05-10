import type { AuthorBookResult } from "../hooks/use-author-availability";
import { IdbCache } from "~/lib/idb-cache";

const LEGACY_KEY = "shelfcheck:author-availability";
const MIN_CACHE_MS = 2 * 60 * 60 * 1000; // 2 hours
const DEFAULT_CACHE_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedAuthorEntry {
  olKey: string;
  resolvedName: string;
  works: AuthorBookResult[];
  fetchedAt: number;
}

const cache = new IdbCache<CachedAuthorEntry>({
  dbName: "shelfcheck-author-availability",
  storeName: "entries",
  legacyLocalStorageKey: LEGACY_KEY,
  maxEntries: 1000,
});

/** Resolves once the IDB-backed author cache has finished its initial load. */
export function whenAuthorAvailabilityCacheReady(): Promise<void> {
  return cache.whenHydrated();
}

/** Compute max cache age based on shortest wait across all works. */
export function authorCacheMaxAge(entry: CachedAuthorEntry): number {
  let minWaitDays: number | null = null;
  for (const work of entry.works) {
    for (const r of work.libbyResults) {
      const days = r.availability.estimatedWaitDays;
      if (days != null && (minWaitDays === null || days < minWaitDays)) {
        minWaitDays = days;
      }
    }
  }

  if (minWaitDays == null) return DEFAULT_CACHE_MS;

  // Half-life of the shortest wait, minimum 2 hours
  const halfLifeMs = (minWaitDays / 2) * 24 * 60 * 60 * 1000;
  return Math.max(halfLifeMs, MIN_CACHE_MS);
}

export function getCachedAuthor(authorId: string): CachedAuthorEntry | null {
  const entry = cache.get(authorId);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > authorCacheMaxAge(entry)) return null;
  return entry;
}

export function setCachedAuthor(
  authorId: string,
  olKey: string,
  resolvedName: string,
  works: AuthorBookResult[],
) {
  cache.set(authorId, { olKey, resolvedName, works, fetchedAt: Date.now() });
}

export function readAuthorCache(): Record<string, CachedAuthorEntry> {
  const out: Record<string, CachedAuthorEntry> = {};
  for (const [key, value] of cache.entries()) out[key] = value;
  return out;
}

/** Test-only: drop the in-memory and persisted caches between cases. */
export function __resetAuthorCacheForTest(): Promise<void> {
  return cache.__resetForTest();
}

/** Test-only: backdate an entry's fetchedAt without round-tripping IDB. */
export function __backdateAuthorForTest(authorId: string, fetchedAt: number): void {
  cache.__backdateForTest(authorId, fetchedAt);
}
