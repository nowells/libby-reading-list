import type { Book } from "./storage";

const BASE = "https://openlibrary.org";
const CACHE_PREFIX = "shelfcheck:ol-isbn:";

// In-flight request deduplication for OpenLibrary fetches.
const olInflight = new Map<string, Promise<unknown>>();
/** Cache successful lookups for 30 days; negative cache for 7 days. */
const POSITIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface OpenLibraryEnrichment {
  workId: string;
  canonicalTitle?: string;
}

interface OpenLibraryEditionResponse {
  title?: string;
  works?: { key?: string }[];
}

/** Extract the workId (e.g. "OL45883W") from an Open Library edition JSON. */
export function parseEdition(edition: unknown): OpenLibraryEnrichment | null {
  if (!edition || typeof edition !== "object") return null;
  const ed = edition as OpenLibraryEditionResponse;
  const workKey = ed.works?.[0]?.key;
  if (!workKey || typeof workKey !== "string") return null;
  const match = workKey.match(/^\/works\/(OL[A-Z0-9]+W)$/);
  if (!match) return null;
  const workId = match[1];
  return {
    workId,
    canonicalTitle: typeof ed.title === "string" && ed.title.trim() ? ed.title.trim() : undefined,
  };
}

interface CacheEntry {
  v: OpenLibraryEnrichment | null;
  /** Expiry timestamp (ms). */
  t: number;
}

function readCache(isbn: string): OpenLibraryEnrichment | null | undefined {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + isbn);
    if (!raw) return undefined;
    const entry = JSON.parse(raw) as CacheEntry;
    if (Date.now() > entry.t) return undefined;
    return entry.v;
  } catch {
    return undefined;
  }
}

function writeCache(isbn: string, value: OpenLibraryEnrichment | null) {
  try {
    const ttl = value ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
    const entry: CacheEntry = { v: value, t: Date.now() + ttl };
    localStorage.setItem(CACHE_PREFIX + isbn, JSON.stringify(entry));
  } catch {
    // Quota or other storage errors are non-fatal.
  }
}

/**
 * Resolve an ISBN to its Open Library Work ID (and canonical title), using a
 * localStorage cache. Returns `null` when Open Library has no record.
 * Network errors resolve to `null` without writing to the cache, so a retry
 * on the next import will re-attempt.
 */
async function lookupIsbn(
  isbn: string,
  signal?: AbortSignal,
): Promise<OpenLibraryEnrichment | null> {
  const clean = isbn.replace(/\D/g, "");
  if (clean.length !== 13 && clean.length !== 10) return null;

  const cached = readCache(clean);
  if (cached !== undefined) return cached;

  const cacheKey = `isbn:${clean}`;
  const existing = olInflight.get(cacheKey);
  if (existing) return existing as Promise<OpenLibraryEnrichment | null>;

  const promise = (async () => {
    try {
      const res = await fetch(`${BASE}/isbn/${clean}.json`, {
        signal,
        headers: { Accept: "application/json" },
      });
      if (res.status === 404) {
        writeCache(clean, null);
        return null;
      }
      if (!res.ok) return null;
      const json: unknown = await res.json();
      const parsed = parseEdition(json);
      writeCache(clean, parsed);
      return parsed;
    } catch {
      return null;
    }
  })().finally(() => {
    olInflight.delete(cacheKey);
  });

  olInflight.set(cacheKey, promise);
  return promise;
}

/**
 * Enrich a list of books by resolving their ISBNs to Open Library works.
 * Concurrent up to `concurrency` in-flight lookups. Books without an ISBN
 * (or that already have a workId) are passed through untouched.
 *
 * `onProgress` is fired once with `(0, total)` before any lookups, then
 * after every completed lookup with the cumulative count, so UIs can
 * render a progress meter without polling.
 */
export async function enrichBooksWithWorkId(
  books: Book[],
  opts: {
    concurrency?: number;
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<Book[]> {
  const concurrency = opts.concurrency ?? 6;
  const out = books.slice();
  const pending = out.map((b, i) => ({ i, b })).filter(({ b }) => !b.workId && b.isbn13);
  const total = pending.length;
  opts.onProgress?.(0, total);
  if (total === 0) return out;

  let cursor = 0;
  let done = 0;
  async function worker() {
    while (cursor < pending.length) {
      const mine = pending[cursor++];
      if (!mine) return;
      const enrichment = await lookupIsbn(mine.b.isbn13!, opts.signal);
      if (enrichment) {
        out[mine.i] = {
          ...mine.b,
          workId: enrichment.workId,
          canonicalTitle: enrichment.canonicalTitle ?? mine.b.canonicalTitle,
        };
      }
      done += 1;
      opts.onProgress?.(done, total);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, total) }, worker);
  await Promise.all(workers);
  return out;
}

/**
 * Parse an Open Library `/works/<id>/editions.json` response into the union
 * of ISBN-13s across all editions, preserving order of appearance.
 * ISBN-10s are converted to 13 (prepend 978, recompute checksum).
 */
export function parseWorkEditions(editions: unknown): string[] {
  if (!editions || typeof editions !== "object") return [];
  const entries = (editions as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as { isbn_13?: unknown; isbn_10?: unknown };
    const thirteens = Array.isArray(e.isbn_13)
      ? e.isbn_13.filter((v) => typeof v === "string")
      : [];
    const tens = Array.isArray(e.isbn_10) ? e.isbn_10.filter((v) => typeof v === "string") : [];
    for (const raw of thirteens) {
      const clean = (raw as string).replace(/\D/g, "");
      if (clean.length === 13 && !seen.has(clean)) {
        seen.add(clean);
        out.push(clean);
      }
    }
    for (const raw of tens) {
      const converted = isbn10to13(raw as string);
      if (converted && !seen.has(converted)) {
        seen.add(converted);
        out.push(converted);
      }
    }
  }
  return out;
}

/** Convert ISBN-10 to ISBN-13 (978 prefix, recompute EAN checksum). */
export function isbn10to13(isbn10: string): string | null {
  const clean = isbn10.replace(/[^0-9X]/gi, "").toUpperCase();
  if (clean.length !== 10) return null;
  const prefix = "978" + clean.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(prefix[i], 10) * (i % 2 === 0 ? 1 : 3);
  }
  const checksum = (10 - (sum % 10)) % 10;
  return prefix + checksum;
}

const EDITIONS_CACHE_PREFIX = "shelfcheck:ol-work-editions:";

interface EditionsCacheEntry {
  v: string[];
  t: number;
}

/**
 * Fetch every ISBN-13 for a work from Open Library, deduped and
 * localStorage-cached. Returns an empty array on error or unknown work.
 */
export async function getWorkEditionIsbns(workId: string, signal?: AbortSignal): Promise<string[]> {
  if (!/^OL[A-Z0-9]+W$/.test(workId)) return [];

  try {
    const raw = localStorage.getItem(EDITIONS_CACHE_PREFIX + workId);
    if (raw) {
      const entry = JSON.parse(raw) as EditionsCacheEntry;
      if (Date.now() <= entry.t) return entry.v;
    }
  } catch {
    // ignore cache read errors
  }

  const cacheKey = `editions:${workId}`;
  const existing = olInflight.get(cacheKey);
  if (existing) return existing as Promise<string[]>;

  const promise = (async () => {
    try {
      const res = await fetch(`${BASE}/works/${workId}/editions.json?limit=500`, {
        signal,
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return [];
      const json: unknown = await res.json();
      const isbns = parseWorkEditions(json);
      try {
        const entry: EditionsCacheEntry = { v: isbns, t: Date.now() + POSITIVE_TTL_MS };
        localStorage.setItem(EDITIONS_CACHE_PREFIX + workId, JSON.stringify(entry));
      } catch {
        // ignore cache write errors
      }
      return isbns;
    } catch {
      return [];
    }
  })().finally(() => {
    olInflight.delete(cacheKey);
  });

  olInflight.set(cacheKey, promise);
  return promise;
}
