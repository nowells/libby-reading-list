import type { AuthorBookResult } from "../hooks/use-author-availability";

const CACHE_KEY = "shelfcheck:author-availability";
const MIN_CACHE_MS = 2 * 60 * 60 * 1000; // 2 hours
const DEFAULT_CACHE_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedAuthorEntry {
  olKey: string;
  resolvedName: string;
  works: AuthorBookResult[];
  fetchedAt: number;
}

function readCache(): Record<string, CachedAuthorEntry> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, CachedAuthorEntry>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore quota errors
  }
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
  const cache = readCache();
  const entry = cache[authorId];
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
  const cache = readCache();
  cache[authorId] = { olKey, resolvedName, works, fetchedAt: Date.now() };
  writeCache(cache);
}

export function readAuthorCache(): Record<string, CachedAuthorEntry> {
  return readCache();
}
