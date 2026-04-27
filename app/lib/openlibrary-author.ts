const BASE = "https://openlibrary.org";
const CACHE_PREFIX = "shelfcheck:ol-author:";
const POSITIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface AuthorWork {
  title: string;
  firstPublishYear?: number;
  coverEditionKey?: string;
  coverId?: number;
  key: string; // e.g. "/works/OL45883W"
}

export interface AuthorSearchResult {
  key: string; // e.g. "OL23919A"
  name: string;
  workCount: number;
  topWork?: string;
}

interface CacheEntry<T> {
  v: T;
  t: number;
}

function readCache<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return undefined;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (Date.now() > entry.t) return undefined;
    return entry.v;
  } catch {
    return undefined;
  }
}

function writeCache<T>(key: string, value: T) {
  try {
    const entry: CacheEntry<T> = { v: value, t: Date.now() + POSITIVE_TTL_MS };
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // Quota or other storage errors are non-fatal.
  }
}

/**
 * Search Open Library for an author by name. Returns top matches.
 */
export async function searchAuthor(
  name: string,
  signal?: AbortSignal,
): Promise<AuthorSearchResult[]> {
  const params = new URLSearchParams({ q: name, limit: "5" });
  const res = await fetch(`${BASE}/search/authors.json?${params}`, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return [];
  const data = await res.json();
  if (!Array.isArray(data.docs)) return [];

  return data.docs.map((doc: Record<string, unknown>) => ({
    key: doc.key as string,
    name: doc.name as string,
    workCount: (doc.work_count as number) ?? 0,
    topWork: doc.top_work as string | undefined,
  }));
}

/**
 * Fetch all works by an author from Open Library, sorted by first publish
 * year descending. Results are cached for 7 days.
 */
export async function getAuthorWorks(
  authorKey: string,
  signal?: AbortSignal,
): Promise<AuthorWork[]> {
  const cacheKey = `works:${authorKey}`;
  const cached = readCache<AuthorWork[]>(cacheKey);
  if (cached) return cached;

  const allWorks: AuthorWork[] = [];
  let offset = 0;
  const limit = 50;

  // Paginate through all works (Open Library caps at 1000)
  while (offset < 1000) {
    const res = await fetch(
      `${BASE}/authors/${authorKey}/works.json?limit=${limit}&offset=${offset}`,
      { signal, headers: { Accept: "application/json" } },
    );
    if (!res.ok) break;
    const data = await res.json();
    const entries = data.entries ?? [];
    if (entries.length === 0) break;

    for (const entry of entries) {
      if (!entry.title) continue;
      allWorks.push({
        title: entry.title,
        firstPublishYear: entry.first_publish_date
          ? parseInt(entry.first_publish_date, 10) || undefined
          : undefined,
        coverEditionKey: entry.covers?.[0] ? undefined : undefined,
        coverId: Array.isArray(entry.covers) ? entry.covers[0] : undefined,
        key: entry.key,
      });
    }

    if (entries.length < limit) break;
    offset += limit;
  }

  // Sort by first publish year descending (newest first), unknowns at end
  allWorks.sort((a, b) => {
    const ya = a.firstPublishYear ?? 0;
    const yb = b.firstPublishYear ?? 0;
    return yb - ya;
  });

  writeCache(cacheKey, allWorks);
  return allWorks;
}

export interface AuthorDetails {
  key: string;
  name: string;
  bio?: string;
  birthDate?: string;
  deathDate?: string;
  alternateNames: string[];
  /** Open Library cover photo IDs in display order. */
  photoIds: number[];
  links: { title: string; url: string }[];
  workCount?: number;
  /** Wikipedia / personal site / etc, parsed from the `wikipedia` and `links` fields. */
  wikipediaUrl?: string;
}

function normalizeOlText(input: unknown): string | undefined {
  if (!input) return undefined;
  if (typeof input === "string") return input.trim() || undefined;
  if (typeof input === "object" && input !== null && "value" in input) {
    const v = (input as { value?: unknown }).value;
    if (typeof v === "string") return v.trim() || undefined;
  }
  return undefined;
}

const DETAILS_CACHE_PREFIX = "shelfcheck:ol-author-details:";

/**
 * Fetch the rich profile for an author — bio, birth/death dates, photos,
 * external links — used by the author details page. Cached for 7 days
 * since these fields change rarely.
 */
export async function getAuthorDetails(
  authorKey: string,
  signal?: AbortSignal,
): Promise<AuthorDetails | null> {
  if (!/^OL[A-Z0-9]+A$/.test(authorKey)) return null;

  try {
    const raw = localStorage.getItem(DETAILS_CACHE_PREFIX + authorKey);
    if (raw) {
      const entry = JSON.parse(raw) as CacheEntry<AuthorDetails>;
      if (Date.now() <= entry.t) return entry.v;
    }
  } catch {
    // ignore
  }

  try {
    const res = await fetch(`${BASE}/authors/${authorKey}.json`, {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      key?: string;
      name?: string;
      bio?: unknown;
      birth_date?: string;
      death_date?: string;
      alternate_names?: string[];
      photos?: number[];
      links?: { title?: string; url?: string }[];
      wikipedia?: string;
    };

    const photoIds = (json.photos ?? [])
      .filter((p): p is number => typeof p === "number" && p > 0)
      .slice(0, 5);

    const alternateNames = (json.alternate_names ?? [])
      .filter((n): n is string => typeof n === "string" && n.trim() !== "")
      .slice(0, 10);

    const links: { title: string; url: string }[] = [];
    for (const l of json.links ?? []) {
      if (l?.title && l?.url && typeof l.title === "string" && typeof l.url === "string") {
        links.push({ title: l.title, url: l.url });
      }
    }

    const details: AuthorDetails = {
      key: authorKey,
      name: typeof json.name === "string" ? json.name : authorKey,
      bio: normalizeOlText(json.bio),
      birthDate: typeof json.birth_date === "string" ? json.birth_date : undefined,
      deathDate: typeof json.death_date === "string" ? json.death_date : undefined,
      alternateNames,
      photoIds,
      links,
      wikipediaUrl: typeof json.wikipedia === "string" ? json.wikipedia : undefined,
    };

    try {
      const entry: CacheEntry<AuthorDetails> = { v: details, t: Date.now() + POSITIVE_TTL_MS };
      localStorage.setItem(DETAILS_CACHE_PREFIX + authorKey, JSON.stringify(entry));
    } catch {
      // ignore
    }

    return details;
  } catch {
    return null;
  }
}

/**
 * Resolve an author name to their Open Library author key.
 * Caches the result.
 */
export async function resolveAuthorKey(
  name: string,
  signal?: AbortSignal,
): Promise<{ key: string; name: string } | null> {
  const cacheKey = `resolve:${name.toLowerCase().trim()}`;
  const cached = readCache<{ key: string; name: string } | null>(cacheKey);
  if (cached !== undefined) return cached;

  const results = await searchAuthor(name, signal);
  if (results.length === 0) {
    writeCache(cacheKey, null);
    return null;
  }

  // Pick best match: prefer exact name match, otherwise first result
  const normalized = name.toLowerCase().trim();
  const exact = results.find((r) => r.name.toLowerCase().trim() === normalized);
  const best = exact ?? results[0];
  const result = { key: best.key, name: best.name };
  writeCache(cacheKey, result);
  return result;
}
