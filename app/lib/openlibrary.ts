import type { Book } from "./storage";

const BASE = "https://openlibrary.org";
const CACHE_PREFIX = "shelfcheck:ol-isbn:";
const SEARCH_CACHE_PREFIX = "shelfcheck:ol-search:";
const FETCH_TIMEOUT_MS = 15_000;

/** Combine an optional caller-provided signal with a timeout signal. */
function timeoutSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  if (!signal) return timeout;
  return AbortSignal.any([signal, timeout]);
}

// In-flight request deduplication for OpenLibrary fetches.
const olInflight = new Map<string, Promise<unknown>>();
/** Cache successful lookups for 30 days. Misses are never cached. */
const POSITIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// One-time migration: purge old negative-cached entries (v=null) left over
// from before we stopped caching misses.
const PURGE_KEY = "shelfcheck:ol-purged-misses";
if (typeof localStorage !== "undefined" && !localStorage.getItem(PURGE_KEY)) {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || (!key.startsWith(CACHE_PREFIX) && !key.startsWith(SEARCH_CACHE_PREFIX))) continue;
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const entry = JSON.parse(raw);
          if (entry.v === null) toRemove.push(key);
        }
      } catch {
        // skip unparseable entries
      }
    }
    for (const key of toRemove) localStorage.removeItem(key);
    localStorage.setItem(PURGE_KEY, "1");
  } catch {
    // non-fatal
  }
}

interface OpenLibraryEnrichment {
  workId: string;
  canonicalTitle?: string;
  canonicalAuthor?: string;
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
  // Don't cache misses — OpenLibrary data grows over time.
  if (!value) return;
  try {
    const entry: CacheEntry = { v: value, t: Date.now() + POSITIVE_TTL_MS };
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
        signal: timeoutSignal(signal),
        headers: { Accept: "application/json" },
      });
      if (res.status === 404) {
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

interface SearchEnrichment extends OpenLibraryEnrichment {
  isbn13?: string;
}

interface SearchCacheEntry {
  v: SearchEnrichment | null;
  t: number;
}

function searchCacheKey(title: string, author: string): string {
  return `${title.toLowerCase().trim()}|${author.toLowerCase().trim()}`;
}

function readSearchCache(key: string): SearchEnrichment | null | undefined {
  try {
    const raw = localStorage.getItem(SEARCH_CACHE_PREFIX + key);
    if (!raw) return undefined;
    const entry = JSON.parse(raw) as SearchCacheEntry;
    if (Date.now() > entry.t) return undefined;
    return entry.v;
  } catch {
    return undefined;
  }
}

function writeSearchCache(key: string, value: SearchEnrichment | null) {
  // Don't cache misses — OpenLibrary data grows over time and a miss today
  // may become a hit tomorrow.
  if (!value) return;
  try {
    const entry: SearchCacheEntry = { v: value, t: Date.now() + POSITIVE_TTL_MS };
    localStorage.setItem(SEARCH_CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // Quota or other storage errors are non-fatal.
  }
}

/** Normalize a string for fuzzy comparison: lowercase, strip punctuation, collapse whitespace. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Search Open Library by title + author to find a work ID and ISBN.
 * Uses the general `q` parameter instead of strict `title`/`author` fields,
 * since the strict fields fail on punctuation differences (e.g. "S.A." vs "S. A.").
 * Validates results by checking both title and author name similarity.
 */
async function searchByTitleAuthor(
  title: string,
  author: string,
  signal?: AbortSignal,
): Promise<SearchEnrichment | null> {
  if (!title.trim() || !author.trim()) return null;

  const cacheKey = searchCacheKey(title, author);
  const cached = readSearchCache(cacheKey);
  if (cached !== undefined) return cached;

  const inflightKey = `search:${cacheKey}`;
  const existing = olInflight.get(inflightKey);
  if (existing) return existing as Promise<SearchEnrichment | null>;

  const promise = (async () => {
    try {
      // Use general `q` search — more forgiving with punctuation and name variants
      // Normalize author to strip stray punctuation (e.g. trailing backslash)
      const normalizedAuthor = normalize(author);
      const authorParts = normalizedAuthor.split(/\s+/);
      const lastName = authorParts[authorParts.length - 1];
      const query = `${title.trim()} ${lastName}`;
      const params = new URLSearchParams({
        q: query,
        limit: "5",
        fields: "key,title,author_name,isbn",
      });
      const res = await fetch(`${BASE}/search.json?${params}`, {
        signal: timeoutSignal(signal),
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        docs?: {
          key?: string;
          title?: string;
          author_name?: string[];
          isbn?: string[];
        }[];
      };
      const docs = json.docs ?? [];
      if (docs.length === 0) {
        return null;
      }

      // Validate results against both title and author
      const normalizedTitle = normalize(title);
      const lastNameLower = lastName.toLowerCase();

      for (const doc of docs) {
        // Check author match: at least last name must appear
        const docAuthors = doc.author_name ?? [];
        const authorMatch = docAuthors.some((a) => {
          const aLower = a.toLowerCase();
          return aLower.includes(lastNameLower);
        });
        if (!authorMatch) continue;

        // Check title match: normalized titles should overlap
        const docTitle = normalize(doc.title ?? "");
        if (
          !docTitle ||
          (!docTitle.includes(normalizedTitle) && !normalizedTitle.includes(docTitle))
        ) {
          // Looser check: compare significant words
          const titleWords = normalizedTitle.split(/\s+/).filter((w) => w.length > 2);
          const matchCount = titleWords.filter((w) => docTitle.includes(w)).length;
          if (titleWords.length === 0 || matchCount < titleWords.length * 0.5) continue;
        }

        const workKey = doc.key;
        if (!workKey) continue;
        const match = workKey.match(/^\/works\/(OL[A-Z0-9]+W)$/);
        if (!match) continue;

        // Extract first valid ISBN-13 if available
        let isbn13: string | undefined;
        for (const raw of doc.isbn ?? []) {
          const clean = raw.replace(/\D/g, "");
          if (clean.length === 13) {
            isbn13 = clean;
            break;
          }
          if (clean.length === 10) {
            isbn13 = isbn10to13(raw) ?? undefined;
            if (isbn13) break;
          }
        }

        const result: SearchEnrichment = {
          workId: match[1],
          canonicalTitle: doc.title?.trim() || undefined,
          canonicalAuthor: docAuthors[0]?.trim() || undefined,
          isbn13,
        };
        writeSearchCache(cacheKey, result);
        return result;
      }

      return null;
    } catch {
      return null;
    }
  })().finally(() => {
    olInflight.delete(inflightKey);
  });

  olInflight.set(inflightKey, promise);
  return promise;
}

/**
 * Public title+author → workId resolver. Wraps the internal search and
 * returns just the workId (or null on miss). Used by the "More in this
 * series" section to make Libby-derived books navigable into our own
 * /book/<workId> pages — Libby supplies the catalog, OL supplies the
 * stable identifier.
 */
export async function resolveWorkIdByTitleAuthor(
  title: string,
  author: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const result = await searchByTitleAuthor(title, author, signal);
  return result?.workId ?? null;
}

/**
 * Enrich a list of books by resolving their ISBNs to Open Library works.
 * Concurrent up to `concurrency` in-flight lookups. Books without an ISBN
 * are searched by title+author. Books that already have a workId are passed
 * through untouched.
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
  // Include books without ISBNs (but with title+author) for title-based search
  const pending = out
    .map((b, i) => ({ i, b }))
    .filter(({ b }) => !b.workId && (b.isbn13 || (b.title && b.author)));
  const total = pending.length;
  opts.onProgress?.(0, total);
  if (total === 0) return out;

  let cursor = 0;
  let done = 0;
  async function worker() {
    while (cursor < pending.length) {
      const mine = pending[cursor++];
      if (!mine) return;

      let enrichment: OpenLibraryEnrichment | null = null;
      let foundIsbn: string | undefined;

      if (mine.b.isbn13) {
        // ISBN lookup (fast, precise)
        enrichment = await lookupIsbn(mine.b.isbn13, opts.signal);
      }

      // Fall back to title+author search when ISBN lookup misses or no ISBN
      if (!enrichment && mine.b.title && mine.b.author) {
        const searchResult = await searchByTitleAuthor(mine.b.title, mine.b.author, opts.signal);
        if (searchResult) {
          enrichment = searchResult;
          foundIsbn = searchResult.isbn13;
        }
      }

      if (enrichment) {
        // Fetch work metadata (subjects, publish year) if not already present
        let { subjects, firstPublishYear } = mine.b;
        if (!subjects || !firstPublishYear) {
          const meta = await getWorkMetadata(enrichment.workId, opts.signal);
          if (meta) {
            subjects = subjects ?? (meta.subjects.length > 0 ? meta.subjects : undefined);
            firstPublishYear = firstPublishYear ?? meta.firstPublishYear;
          }
        }

        out[mine.i] = {
          ...mine.b,
          workId: enrichment.workId,
          canonicalTitle: enrichment.canonicalTitle ?? mine.b.canonicalTitle,
          canonicalAuthor: enrichment.canonicalAuthor ?? mine.b.canonicalAuthor,
          isbn13: mine.b.isbn13 ?? foundIsbn,
          subjects,
          firstPublishYear,
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
        signal: timeoutSignal(signal),
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

// --- Work Metadata (subjects, publish year) ---

const WORK_META_CACHE_PREFIX = "shelfcheck:ol-work-meta:";

interface WorkMetadata {
  subjects: string[];
  firstPublishYear?: number;
}

interface WorkMetaCacheEntry {
  v: WorkMetadata;
  t: number;
}

/**
 * Fetch work-level metadata (subjects, first publish year) from Open Library,
 * with localStorage caching and in-flight deduplication.
 */
export async function getWorkMetadata(
  workId: string,
  signal?: AbortSignal,
): Promise<WorkMetadata | null> {
  if (!/^OL[A-Z0-9]+W$/.test(workId)) return null;

  try {
    const raw = localStorage.getItem(WORK_META_CACHE_PREFIX + workId);
    if (raw) {
      const entry = JSON.parse(raw) as WorkMetaCacheEntry;
      if (Date.now() <= entry.t) return entry.v;
    }
  } catch {
    // ignore
  }

  const inflightKey = `work-meta:${workId}`;
  const existing = olInflight.get(inflightKey);
  if (existing) return existing as Promise<WorkMetadata | null>;

  const promise = (async () => {
    try {
      const res = await fetch(`${BASE}/works/${workId}.json`, {
        signal: timeoutSignal(signal),
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        subjects?: string[];
        first_publish_date?: string;
      };

      const subjects = (json.subjects ?? [])
        .filter((s): s is string => typeof s === "string")
        .slice(0, 20);

      let firstPublishYear: number | undefined;
      if (json.first_publish_date) {
        const yearMatch = json.first_publish_date.match(/\d{4}/);
        if (yearMatch) firstPublishYear = parseInt(yearMatch[0], 10);
      }

      const meta: WorkMetadata = { subjects, firstPublishYear };

      try {
        const entry: WorkMetaCacheEntry = { v: meta, t: Date.now() + POSITIVE_TTL_MS };
        localStorage.setItem(WORK_META_CACHE_PREFIX + workId, JSON.stringify(entry));
      } catch {
        // ignore
      }
      return meta;
    } catch {
      return null;
    }
  })().finally(() => {
    olInflight.delete(inflightKey);
  });

  olInflight.set(inflightKey, promise);
  return promise;
}

// --- Rich Work Details (description, covers, authors, links) ---

const WORK_DETAILS_CACHE_PREFIX = "shelfcheck:ol-work-details:";
const RATINGS_CACHE_PREFIX = "shelfcheck:ol-work-ratings:";
const SERIES_CACHE_PREFIX = "shelfcheck:ol-series:";
/** Ratings move daily; cache for a day so users don't see stale numbers for too long. */
const SHORT_TTL_MS = 24 * 60 * 60 * 1000;

export interface WorkAuthorRef {
  /** Open Library Author key (e.g. "OL23919A"). */
  key: string;
  name?: string;
}

export interface WorkLink {
  title: string;
  url: string;
}

export interface WorkDetails {
  workId: string;
  title?: string;
  subtitle?: string;
  description?: string;
  subjects: string[];
  subjectPlaces: string[];
  subjectPeople: string[];
  subjectTimes: string[];
  firstPublishYear?: number;
  /** Open Library cover IDs in display order. */
  coverIds: number[];
  authors: WorkAuthorRef[];
  links: WorkLink[];
}

/**
 * Open Library descriptions can be either a plain string or a typed-text
 * object `{ type: "/type/text", value: "..." }`. Normalize to a string.
 */
function normalizeOlText(input: unknown): string | undefined {
  if (!input) return undefined;
  if (typeof input === "string") return input.trim() || undefined;
  if (typeof input === "object" && input !== null && "value" in input) {
    const v = (input as { value?: unknown }).value;
    if (typeof v === "string") return v.trim() || undefined;
  }
  return undefined;
}

interface WorkDetailsCacheEntry {
  v: WorkDetails;
  t: number;
}

/**
 * Fetch a complete view of a work — title, description, subjects, authors,
 * covers, external links — for the dedicated details page. Cached for the
 * positive TTL since work pages rarely change. Pulls only the work-level
 * record; edition-specific data (page count, publisher) comes from
 * `getWorkEditionSummaries` on demand.
 */
export async function getWorkDetails(
  workId: string,
  signal?: AbortSignal,
): Promise<WorkDetails | null> {
  if (!/^OL[A-Z0-9]+W$/.test(workId)) return null;

  try {
    const raw = localStorage.getItem(WORK_DETAILS_CACHE_PREFIX + workId);
    if (raw) {
      const entry = JSON.parse(raw) as WorkDetailsCacheEntry;
      if (Date.now() <= entry.t) return entry.v;
    }
  } catch {
    // ignore cache read
  }

  const inflightKey = `work-details:${workId}`;
  const existing = olInflight.get(inflightKey);
  if (existing) return existing as Promise<WorkDetails | null>;

  const promise = (async () => {
    try {
      const res = await fetch(`${BASE}/works/${workId}.json`, {
        signal: timeoutSignal(signal),
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        title?: string;
        subtitle?: string;
        description?: unknown;
        subjects?: string[];
        subject_places?: string[];
        subject_people?: string[];
        subject_times?: string[];
        first_publish_date?: string;
        covers?: number[];
        authors?: { author?: { key?: string }; type?: { key?: string } }[];
        links?: { title?: string; url?: string }[];
      };

      const subjects = (json.subjects ?? [])
        .filter((s): s is string => typeof s === "string")
        .slice(0, 30);
      const subjectPlaces = (json.subject_places ?? [])
        .filter((s): s is string => typeof s === "string")
        .slice(0, 10);
      const subjectPeople = (json.subject_people ?? [])
        .filter((s): s is string => typeof s === "string")
        .slice(0, 10);
      const subjectTimes = (json.subject_times ?? [])
        .filter((s): s is string => typeof s === "string")
        .slice(0, 10);

      let firstPublishYear: number | undefined;
      if (json.first_publish_date) {
        const yearMatch = json.first_publish_date.match(/\d{4}/);
        if (yearMatch) firstPublishYear = parseInt(yearMatch[0], 10);
      }

      const coverIds = (json.covers ?? [])
        .filter((c): c is number => typeof c === "number" && c > 0)
        .slice(0, 5);

      const authors: WorkAuthorRef[] = [];
      for (const a of json.authors ?? []) {
        const key = a?.author?.key;
        if (typeof key !== "string") continue;
        const m = key.match(/\/authors\/(OL[A-Z0-9]+A)$/);
        if (!m) continue;
        if (authors.some((x) => x.key === m[1])) continue;
        authors.push({ key: m[1] });
      }

      const links: WorkLink[] = [];
      for (const l of json.links ?? []) {
        if (l?.title && l?.url && typeof l.title === "string" && typeof l.url === "string") {
          links.push({ title: l.title, url: l.url });
        }
      }

      const details: WorkDetails = {
        workId,
        title: typeof json.title === "string" ? json.title.trim() || undefined : undefined,
        subtitle: typeof json.subtitle === "string" ? json.subtitle.trim() || undefined : undefined,
        description: normalizeOlText(json.description),
        subjects,
        subjectPlaces,
        subjectPeople,
        subjectTimes,
        firstPublishYear,
        coverIds,
        authors,
        links,
      };

      try {
        const entry: WorkDetailsCacheEntry = { v: details, t: Date.now() + POSITIVE_TTL_MS };
        localStorage.setItem(WORK_DETAILS_CACHE_PREFIX + workId, JSON.stringify(entry));
      } catch {
        // ignore
      }
      return details;
    } catch {
      return null;
    }
  })().finally(() => {
    olInflight.delete(inflightKey);
  });

  olInflight.set(inflightKey, promise);
  return promise;
}

export interface WorkRatings {
  /** Average rating out of 5, when known. */
  average?: number;
  /** Total number of ratings. */
  count: number;
  histogram?: Record<"1" | "2" | "3" | "4" | "5", number>;
}

interface RatingsCacheEntry {
  v: WorkRatings;
  t: number;
}

/**
 * Fetch the aggregated user-rating summary for a work. Cached briefly
 * (1 day) so the displayed average doesn't drift too far from the live
 * Open Library number.
 */
export async function getWorkRatings(
  workId: string,
  signal?: AbortSignal,
): Promise<WorkRatings | null> {
  if (!/^OL[A-Z0-9]+W$/.test(workId)) return null;

  try {
    const raw = localStorage.getItem(RATINGS_CACHE_PREFIX + workId);
    if (raw) {
      const entry = JSON.parse(raw) as RatingsCacheEntry;
      if (Date.now() <= entry.t) return entry.v;
    }
  } catch {
    // ignore
  }

  const inflightKey = `ratings:${workId}`;
  const existing = olInflight.get(inflightKey);
  if (existing) return existing as Promise<WorkRatings | null>;

  const promise = (async () => {
    try {
      const res = await fetch(`${BASE}/works/${workId}/ratings.json`, {
        signal: timeoutSignal(signal),
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        summary?: { average?: number; count?: number };
        counts?: Record<string, number>;
      };

      const ratings: WorkRatings = {
        average:
          typeof json.summary?.average === "number" && json.summary.average > 0
            ? json.summary.average
            : undefined,
        count: typeof json.summary?.count === "number" ? json.summary.count : 0,
      };

      if (json.counts && typeof json.counts === "object") {
        const h: WorkRatings["histogram"] = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
        for (const k of ["1", "2", "3", "4", "5"] as const) {
          const v = json.counts[k];
          if (typeof v === "number") h[k] = v;
        }
        ratings.histogram = h;
      }

      try {
        const entry: RatingsCacheEntry = { v: ratings, t: Date.now() + SHORT_TTL_MS };
        localStorage.setItem(RATINGS_CACHE_PREFIX + workId, JSON.stringify(entry));
      } catch {
        // ignore
      }
      return ratings;
    } catch {
      return null;
    }
  })().finally(() => {
    olInflight.delete(inflightKey);
  });

  olInflight.set(inflightKey, promise);
  return promise;
}

/**
 * Compact roll-up of edition records used by the book details page:
 * the most-common publisher, the median page count, and a representative
 * publish date. Pulls from the same `/editions.json` payload that
 * `getWorkEditionIsbns` consumes.
 */
export async function getWorkEditionSummary(
  workId: string,
  signal?: AbortSignal,
): Promise<{
  pageCount?: number;
  publishers: string[];
  earliestPublishYear?: number;
  totalEditions: number;
  languages: string[];
} | null> {
  if (!/^OL[A-Z0-9]+W$/.test(workId)) return null;

  try {
    const res = await fetch(`${BASE}/works/${workId}/editions.json?limit=200`, {
      signal: timeoutSignal(signal),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      entries?: {
        publishers?: string[];
        publish_date?: string;
        number_of_pages?: number;
        languages?: { key?: string }[];
      }[];
    };

    const entries = json.entries ?? [];
    if (entries.length === 0) {
      return { publishers: [], totalEditions: 0, languages: [] };
    }

    const publisherCounts = new Map<string, number>();
    const pageCounts: number[] = [];
    const languageCounts = new Map<string, number>();
    let earliestYear: number | undefined;

    for (const e of entries) {
      for (const p of e.publishers ?? []) {
        if (typeof p === "string" && p.trim()) {
          const key = p.trim();
          publisherCounts.set(key, (publisherCounts.get(key) ?? 0) + 1);
        }
      }
      if (typeof e.number_of_pages === "number" && e.number_of_pages > 0) {
        pageCounts.push(e.number_of_pages);
      }
      if (typeof e.publish_date === "string") {
        const m = e.publish_date.match(/\d{4}/);
        if (m) {
          const y = parseInt(m[0], 10);
          if (!earliestYear || y < earliestYear) earliestYear = y;
        }
      }
      for (const l of e.languages ?? []) {
        const m = l?.key?.match(/\/languages\/([a-z]+)$/);
        if (m) languageCounts.set(m[1], (languageCounts.get(m[1]) ?? 0) + 1);
      }
    }

    let medianPages: number | undefined;
    if (pageCounts.length > 0) {
      pageCounts.sort((a, b) => a - b);
      medianPages = pageCounts[Math.floor(pageCounts.length / 2)];
    }

    const publishers = Array.from(publisherCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map((p) => p[0])
      .slice(0, 5);

    const languages = Array.from(languageCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map((p) => p[0])
      .slice(0, 5);

    return {
      pageCount: medianPages,
      publishers,
      earliestPublishYear: earliestYear,
      totalEditions: entries.length,
      languages,
    };
  } catch {
    return null;
  }
}

export interface SeriesBook {
  workId: string;
  title: string;
  firstPublishYear?: number;
  coverId?: number;
  authorName?: string;
  /** Reading order if Open Library indexes it (e.g. "1", "2.5"). Often unset. */
  readingOrder?: string;
}

interface SeriesCacheEntry {
  v: SeriesBook[];
  t: number;
}

/**
 * OL's `series` field is unstructured and free-form. Per work it's a list of
 * strings that often carry the position one of a handful of ways:
 *   "Discworld ; #1", "Discworld 1", "Discworld, Book 1", "Discworld #1"
 * Try to extract a leading number for the matching series name; return
 * undefined if nothing usable is found.
 */
export function parseSeriesOrder(
  series: string[] | undefined,
  seriesNameLower: string,
): string | undefined {
  if (!series?.length) return undefined;
  for (const raw of series) {
    if (typeof raw !== "string") continue;
    const lower = raw.toLowerCase();
    // Only consider strings that mention the series we care about — works can
    // belong to multiple series and we don't want to grab an unrelated number.
    if (!lower.includes(seriesNameLower)) continue;
    // Strip the series name to isolate the position fragment.
    const rest = lower.replace(seriesNameLower, "");
    const m = rest.match(/(\d+(?:\.\d+)?)/);
    if (m) return m[1];
  }
  return undefined;
}

/**
 * Words OL search would treat as noise inside a series name. Libby tends
 * to spell out role/honorific titles ("Chief Inspector Armand Gamache")
 * while OL stores the series under shorter labels ("Chief Inspector
 * Gamache" or "Three Pines"); stripping these is the difference between
 * 0 results and a useful list.
 */
const SERIES_NOISE_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "of",
  "novel",
  "novels",
  "series",
  "saga",
  "trilogy",
  "chronicles",
  "mysteries",
  "mystery",
  "chief",
  "inspector",
  "detective",
  "officer",
  "agent",
  "captain",
  "sergeant",
  "lieutenant",
  "professor",
  "doctor",
  "lord",
  "lady",
  "sir",
  "mr",
  "mrs",
  "ms",
  "dr",
]);

function stripNoiseWords(seriesName: string): string {
  return seriesName
    .split(/\s+/)
    .filter((w) => w && !SERIES_NOISE_WORDS.has(w.toLowerCase().replace(/[^a-z]/g, "")))
    .join(" ")
    .trim();
}

function significantSeriesTokens(seriesName: string): string[] {
  return seriesName
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ""))
    .filter((w) => w.length > 2 && !SERIES_NOISE_WORDS.has(w.toLowerCase()));
}

/**
 * Build a sequence of OL search queries from most-precise to most-permissive,
 * each tried in turn until one returns post-filterable hits. Exported for
 * testing.
 */
export function buildSeriesQueries(seriesName: string, author?: string): string[] {
  const trimmed = seriesName.trim();
  if (!trimmed) return [];

  const queries: string[] = [];
  const seen = new Set<string>();
  const push = (q: string) => {
    if (!seen.has(q)) {
      seen.add(q);
      queries.push(q);
    }
  };

  // 1. Exact phrase — wins when Libby and OL agree on the canonical name.
  push(`series:"${trimmed}"`);

  // 2. Drop role/honorific noise — handles "Chief Inspector Armand Gamache"
  //    in Libby vs. "Armand Gamache" / "Chief Inspector Gamache" in OL.
  const stripped = stripNoiseWords(trimmed);
  if (stripped && stripped.toLowerCase() !== trimmed.toLowerCase()) {
    push(`series:"${stripped}"`);
  }

  // 3. AND of the significant tokens. OL treats unquoted multi-token
  //    series queries permissively, but ANDing forces every distinctive
  //    word to appear somewhere in the series field.
  const tokens = significantSeriesTokens(trimmed);
  if (tokens.length > 1) {
    push(`series:(${tokens.join(" AND ")})`);
  }

  // 4. Last resort: the longest distinctive token, scoped by author when
  //    we have one. "Gamache" by itself plus author=Penny is plenty
  //    specific without depending on OL's exact series label.
  if (tokens.length > 0) {
    const distinctive = [...tokens].sort((a, b) => b.length - a.length)[0];
    if (author) {
      push(`series:${distinctive} author:"${author.replace(/"/g, "")}"`);
    } else {
      push(`series:${distinctive}`);
    }
  }

  return queries;
}

interface SeriesSearchDoc {
  key?: string;
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
  series?: string[];
}

async function fetchSeriesDocs(query: string, signal?: AbortSignal): Promise<SeriesSearchDoc[]> {
  const params = new URLSearchParams({
    q: query,
    limit: "30",
    fields: "key,title,author_name,first_publish_year,cover_i,series",
  });
  const res = await fetch(`${BASE}/search.json?${params}`, {
    signal: timeoutSignal(signal),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { docs?: SeriesSearchDoc[] };
  return json.docs ?? [];
}

/**
 * Decide whether a search hit really belongs to the target series. With
 * the looser fallback queries OL will happily return tangentially-related
 * works (a book mentioning "Gamache" but in a different series), so we
 * post-filter on:
 *   - author overlap when the caller knows the author, AND
 *   - significant-token overlap with the doc's `series` field, when set.
 * If the doc has no `series` field at all we accept it — the looser
 * queries find spin-offs that OL hasn't tagged.
 */
function docMatchesSeries(
  doc: SeriesSearchDoc,
  significantTokens: string[],
  authorLower: string | undefined,
): boolean {
  if (authorLower) {
    const authorLast = authorLower.split(/\s+/).pop() ?? authorLower;
    const authors = (doc.author_name ?? []).map((a) => a.toLowerCase());
    const authorMatch = authors.some((a) => a.includes(authorLast) || authorLast.includes(a));
    if (!authorMatch) return false;
  }
  if (!doc.series?.length || significantTokens.length === 0) {
    return authorLower !== undefined; // no series field: trust the author scope
  }
  const seriesBlob = doc.series.join(" ").toLowerCase();
  const hits = significantTokens.filter((t) => seriesBlob.includes(t.toLowerCase())).length;
  // Require at least one distinctive token to appear; for multi-token
  // names, demand a majority so "Wheel of Time" doesn't accept a series
  // that only mentions "Time".
  return hits >= Math.max(1, Math.ceil(significantTokens.length / 2));
}

/**
 * Find every work Open Library tags with the given series name. Useful for
 * the "More in this series" section on a book details page. Cached for
 * the positive TTL since series rarely add books day-to-day.
 *
 * Open Library has no first-class series endpoint, so this leans on the
 * search index with a quoted series filter. The exact-phrase query alone
 * misses any series where Libby and OL disagree on the canonical name —
 * "Chief Inspector Armand Gamache" (Libby) vs. "Chief Inspector Gamache"
 * (OL) — so we try a small ladder of progressively looser queries and
 * post-filter the union by author + series-field overlap.
 */
export async function searchSeriesBooks(
  seriesName: string,
  options: { author?: string } = {},
  signal?: AbortSignal,
): Promise<SeriesBook[]> {
  const trimmed = seriesName.trim();
  if (!trimmed) return [];

  // Cache key includes the author scope so a series we found via author-
  // assisted fallback isn't replayed when called without an author later.
  const cacheKey = `${trimmed.toLowerCase()}|${options.author?.toLowerCase() ?? ""}`;
  try {
    const raw = localStorage.getItem(SERIES_CACHE_PREFIX + cacheKey);
    if (raw) {
      const entry = JSON.parse(raw) as SeriesCacheEntry;
      if (Date.now() <= entry.t) return entry.v;
    }
  } catch {
    // ignore
  }

  const inflightKey = `series:${cacheKey}`;
  const existing = olInflight.get(inflightKey);
  if (existing) return existing as Promise<SeriesBook[]>;

  const promise = (async () => {
    try {
      const queries = buildSeriesQueries(trimmed, options.author);
      const tokens = significantSeriesTokens(trimmed);
      const authorLower = options.author?.toLowerCase();

      let docs: SeriesSearchDoc[] = [];
      for (const query of queries) {
        const fetched = await fetchSeriesDocs(query, signal);
        if (fetched.length === 0) continue;
        const filtered = fetched.filter((d) => docMatchesSeries(d, tokens, authorLower));
        if (filtered.length > 0) {
          docs = filtered;
          break;
        }
      }

      const out: SeriesBook[] = [];
      const seen = new Set<string>();
      const trimmedLower = trimmed.toLowerCase();
      for (const doc of docs) {
        const m = doc.key?.match(/^\/works\/(OL[A-Z0-9]+W)$/);
        if (!m) continue;
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        if (typeof doc.title !== "string") continue;
        out.push({
          workId: m[1],
          title: doc.title,
          firstPublishYear: doc.first_publish_year,
          coverId: doc.cover_i,
          authorName: doc.author_name?.[0],
          readingOrder: parseSeriesOrder(doc.series, trimmedLower),
        });
      }

      // Sort by series reading order when we can parse one (most reliable for
      // series with prequels published out of order); fall back to first
      // publish year, which approximates reading order for the common case.
      out.sort((a, b) => {
        const ao = parseFloat(a.readingOrder ?? "");
        const bo = parseFloat(b.readingOrder ?? "");
        const aHas = Number.isFinite(ao);
        const bHas = Number.isFinite(bo);
        if (aHas && bHas && ao !== bo) return ao - bo;
        if (aHas !== bHas) return aHas ? -1 : 1;
        return (a.firstPublishYear ?? 9999) - (b.firstPublishYear ?? 9999);
      });

      try {
        const entry: SeriesCacheEntry = { v: out, t: Date.now() + POSITIVE_TTL_MS };
        localStorage.setItem(SERIES_CACHE_PREFIX + cacheKey, JSON.stringify(entry));
      } catch {
        // ignore
      }
      return out;
    } catch {
      return [];
    }
  })().finally(() => {
    olInflight.delete(inflightKey);
  });

  olInflight.set(inflightKey, promise);
  return promise;
}
