import type { BookAvailability } from "~/lib/libby";

const CACHE_KEY = "shelfcheck:availability";
const AVAILABLE_NOW_CACHE_MS = 1 * 60 * 60 * 1000; // 1 hour — available books can disappear
const MIN_CACHE_MS = 2 * 60 * 60 * 1000; // 2 hours
const DEFAULT_CACHE_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedEntry {
  data: BookAvailability;
  fetchedAt: number;
}

export function readCache(): Record<string, CachedEntry> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, CachedEntry>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore quota errors
  }
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
  const cache = readCache();
  const entry = cache[bookId];
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > cacheMaxAge(entry)) return null;
  return entry;
}

export function setCached(bookId: string, data: BookAvailability) {
  const cache = readCache();
  cache[bookId] = { data, fetchedAt: Date.now() };
  writeCache(cache);
}
