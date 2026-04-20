const THUNDER_API_URL = "https://thunder.api.overdrive.com/v2";

export interface LibbyLibrary {
  id: number;
  name: string;
  fulfillmentId: string;
  preferredKey?: string;
  type?: string;
  isConsortium?: boolean;
  logoUrl?: string;
}

export interface LibbyMediaItem {
  id: string;
  title: string;
  sortTitle: string;
  subtitle?: string;
  type: { id: string; name: string };
  formats: Array<{ id: string; name: string; duration?: string }>;
  creators: Array<{ name: string; role: string }>;
  covers?: { cover150Wide?: { href: string } };
  series?: string;
  detailedSeries?: {
    seriesName: string;
    readingOrder: string;
  };
  firstCreatorSortName?: string;
  publisher?: { id: string; name: string };
  publishDate?: string;
  isAvailable?: boolean;
  ownedCopies?: number;
  availableCopies?: number;
  holdsCount?: number;
  estimatedWaitDays?: number;
}

export interface AvailabilityInfo {
  id: string;
  copiesOwned: number;
  copiesAvailable: number;
  numberOfHolds: number;
  isAvailable: boolean;
  estimatedWaitDays?: number;
}

async function thunderFetch(path: string) {
  const url = `${THUNDER_API_URL}${path}`;
  const res = await fetch(url, {
    headers: {
      "x-client-id": "dewey",
    },
  });
  if (!res.ok) {
    throw new Error(`Libby API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function getLibraryPreferredKey(fulfillmentId: string): Promise<string> {
  const data = await thunderFetch(`/libraries/${fulfillmentId}`);
  return data.preferredKey ?? fulfillmentId;
}

export async function searchLibrary(
  libraryKey: string,
  query: string,
  format?: "ebook" | "audiobook",
): Promise<LibbyMediaItem[]> {
  const params = new URLSearchParams({ query });
  if (format === "ebook") {
    params.set(
      "format",
      "ebook-kindle,ebook-overdrive,ebook-epub-adobe,ebook-epub-open,ebook-media-do",
    );
  } else if (format === "audiobook") {
    params.set("format", "audiobook-overdrive,audiobook-mp3");
  }
  const data = await thunderFetch(`/libraries/${libraryKey}/media?${params.toString()}`);
  return data.items ?? [];
}

// Large reference library used for deep search (scope-auto) when local search finds nothing
export const REFERENCE_LIBRARY = "lapl";

async function getMediaItem(libraryKey: string, titleId: string): Promise<LibbyMediaItem | null> {
  try {
    return await thunderFetch(`/libraries/${libraryKey}/media/${titleId}`);
  } catch {
    return null;
  }
}

export async function searchLibraryByName(query: string): Promise<LibbyLibrary[]> {
  const url = `https://locate.libbyapp.com/autocomplete/${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Libby locate API error: ${res.status}`);
  }
  const data = await res.json();

  const seen = new Set<number>();
  const libraries: LibbyLibrary[] = [];

  for (const branch of data.branches ?? []) {
    for (const system of branch.systems ?? []) {
      if (seen.has(system.id)) continue;
      seen.add(system.id);
      libraries.push({
        id: system.id,
        name: system.name,
        fulfillmentId: system.fulfillmentId,
        type: system.type,
        isConsortium: system.isConsortium,
        logoUrl: system.styling?.logos?.[0]?.sourceUrl,
      });
    }
  }

  return libraries;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "in",
  "on",
  "at",
  "to",
  "for",
  "is",
  "it",
  "by",
  "as",
  "be",
  "no",
  "not",
  "but",
  "from",
  "with",
]);

function normalize(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function contentWords(s: string): string[] {
  return normalize(s)
    .split(" ")
    .filter((w) => !STOP_WORDS.has(w) && w.length > 0);
}

function similarityScore(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;

  const wordsA = na.split(" ");
  const wordsB = nb.split(" ");
  const intersection = wordsA.filter((w) => wordsB.includes(w));
  return (2 * intersection.length) / (wordsA.length + wordsB.length);
}

// Check that every significant word in the search title appears in the
// result title. Strict (all-must-match) so that titles which only share
// the series stem — "Children of Time" vs "Children of Ruin" — don't get
// accepted as the same book. Exported for tests.
export function contentWordsMatch(searchTitle: string, resultTitle: string): boolean {
  const searchContent = contentWords(searchTitle);
  if (searchContent.length === 0) return true;
  const resultContent = new Set(contentWords(resultTitle));
  return searchContent.every((w) => resultContent.has(w));
}

export interface BookAvailabilityResult {
  mediaItem: LibbyMediaItem;
  availability: AvailabilityInfo;
  matchScore: number;
  formatType: string;
  libraryKey: string;
}

export interface SeriesInfo {
  seriesName: string;
  readingOrder: string;
}

export interface BookAvailability {
  bookTitle: string;
  bookAuthor: string;
  coverUrl?: string;
  seriesInfo?: SeriesInfo;
  results: BookAvailabilityResult[];
}

// Pull availability from the LibbyMediaItem itself rather than calling the
// dedicated /availability endpoint per item — the search response already
// carries every field we need (copies, holds, isAvailable, ETA), and
// skipping the second round-trip cuts request volume roughly in half.
// Use `fetchLiveAvailability` for the canonical, non-cached numbers when a
// user explicitly refreshes a single book.
function availabilityFor(item: LibbyMediaItem): AvailabilityInfo {
  return {
    id: item.id,
    copiesOwned: item.ownedCopies ?? 0,
    copiesAvailable: item.availableCopies ?? 0,
    numberOfHolds: item.holdsCount ?? 0,
    isAvailable: item.isAvailable ?? (item.availableCopies ?? 0) > 0,
    estimatedWaitDays: item.estimatedWaitDays,
  };
}

/**
 * Hit the canonical /availability endpoint for a single title. Slower than
 * relying on search-embedded fields (which may be a few minutes more
 * cached on Libby's CDN), so this is reserved for explicit per-book
 * refreshes rather than the bulk first-load path.
 */
async function fetchLiveAvailability(
  libraryKey: string,
  titleId: string,
): Promise<AvailabilityInfo> {
  const data = await thunderFetch(`/libraries/${libraryKey}/media/${titleId}/availability`);
  return {
    id: titleId,
    copiesOwned: data.ownedCopies ?? 0,
    copiesAvailable: data.availableCopies ?? 0,
    numberOfHolds: data.holdsCount ?? 0,
    isAvailable: data.isAvailable ?? (data.availableCopies ?? 0) > 0,
    estimatedWaitDays: data.estimatedWaitDays,
  };
}

function buildResult(
  libraryKey: string,
  item: LibbyMediaItem,
  avail: AvailabilityInfo,
  matchScore: number,
): BookAvailabilityResult {
  return {
    mediaItem: item,
    availability: avail,
    matchScore,
    formatType: item.type?.id ?? "unknown",
    libraryKey,
  };
}

export async function findBookInLibrary(
  libraryKey: string,
  title: string,
  author: string,
  options: {
    primaryIsbn?: string;
    /**
     * Lazy resolver for alternate-edition ISBNs. Only invoked when the
     * primary ISBN search misses, so books found on their primary ISBN
     * never trigger an Open Library editions fetch.
     */
    getAlternateIsbns?: () => Promise<string[]>;
    /**
     * When true, hit the dedicated /availability endpoint for each match
     * after the search-based pass — slower but returns canonical numbers
     * not subject to Libby's CDN cache. Reserved for explicit per-book
     * refreshes.
     */
    liveAvailability?: boolean;
  } = {},
): Promise<BookAvailability> {
  const result: BookAvailability = {
    bookTitle: title,
    bookAuthor: author,
    results: [],
  };

  const seenIds = new Set<string>();

  async function tryIsbn(isbn: string) {
    try {
      const items = await searchLibrary(libraryKey, isbn);
      for (const item of items.slice(0, 3)) {
        if (seenIds.has(item.id)) continue;
        seenIds.add(item.id);
        result.results.push(buildResult(libraryKey, item, availabilityFor(item), 1));
      }
    } catch {
      // Continue to next ISBN
    }
  }

  // Phase 1a: primary ISBN — the most precise lookup, treated as a
  // definitive match (no title/author similarity gate).
  if (options.primaryIsbn) {
    await tryIsbn(options.primaryIsbn);
  }

  // Phase 1b: alternate-edition ISBNs from Open Library. Resolved lazily
  // so books found on their primary ISBN don't pay for the OL editions
  // round-trip.
  if (result.results.length === 0 && options.getAlternateIsbns) {
    const MAX_ALT_TRIES = 5;
    try {
      const alts = await options.getAlternateIsbns();
      for (const isbn of alts.slice(0, MAX_ALT_TRIES)) {
        if (result.results.length > 0) break;
        if (isbn === options.primaryIsbn) continue;
        await tryIsbn(isbn);
      }
    } catch {
      // Alt-ISBN resolution failed; fall through to text search.
    }
  }

  // Phase 2: text search fallback. The contentWordsMatch gate now requires
  // every search content word to be present in the result title, so series
  // books like "Children of Ruin" no longer match "Children of Time".
  if (result.results.length === 0) {
    const queries = [
      `${author} ${title}`,
      title.includes(":") ? `${author} ${title.split(":")[0].trim()}` : null,
      title,
    ].filter(Boolean) as string[];

    for (const query of queries) {
      try {
        const items = await searchLibrary(libraryKey, query);
        for (const item of items.slice(0, 5)) {
          if (seenIds.has(item.id)) continue;

          const titleScore = similarityScore(title, item.title);
          const authorName = item.creators?.find((c) => c.role === "Author")?.name ?? "";
          const authorScore = author ? similarityScore(author, authorName) : 0.5;

          if (titleScore >= 0.4 && authorScore >= 0.3 && contentWordsMatch(title, item.title)) {
            seenIds.add(item.id);
            result.results.push(
              buildResult(libraryKey, item, availabilityFor(item), (titleScore + authorScore) / 2),
            );
          }
        }
      } catch {
        // Continue to next query
      }

      if (result.results.length > 0) break;
    }
  }

  // Phase 3: reference-library deep search — when the user's library has
  // no hit at all, fall back to a large reference library to find a
  // canonical OverDrive title id, then fetch the local copy from the
  // user's library. Mirrors Libby's "scope-auto" notify-me behavior.
  if (result.results.length === 0 && libraryKey !== REFERENCE_LIBRARY) {
    try {
      const refItems = await searchLibrary(REFERENCE_LIBRARY, `${author} ${title}`);
      for (const item of refItems.slice(0, 5)) {
        if (seenIds.has(item.id)) continue;

        const titleScore = similarityScore(title, item.title);
        const authorName = item.creators?.find((c) => c.role === "Author")?.name ?? "";
        const authorScore = author ? similarityScore(author, authorName) : 0.5;

        if (titleScore >= 0.4 && authorScore >= 0.3 && contentWordsMatch(title, item.title)) {
          seenIds.add(item.id);
          const localItem = await getMediaItem(libraryKey, item.id);
          if (!localItem) continue;
          result.results.push(
            buildResult(
              libraryKey,
              localItem,
              availabilityFor(localItem),
              (titleScore + authorScore) / 2,
            ),
          );
        }
      }
    } catch {
      // Deep search failed, continue without results
    }
  }

  // Optional: replace search-embedded availability with canonical numbers
  // from the /availability endpoint. Only requested for explicit per-book
  // refreshes so we don't pay an extra round-trip for every match on the
  // initial bulk load.
  if (options.liveAvailability && result.results.length > 0) {
    await Promise.all(
      result.results.map(async (r) => {
        try {
          r.availability = await fetchLiveAvailability(r.libraryKey, r.mediaItem.id);
        } catch {
          // Keep the search-embedded availability if the canonical fetch fails.
        }
      }),
    );
  }

  result.results.sort((a, b) => b.matchScore - a.matchScore);

  // Pick the best cover image and series info from the highest-scoring result
  for (const r of result.results) {
    const href = r.mediaItem.covers?.cover150Wide?.href;
    if (href && !result.coverUrl) {
      result.coverUrl = href;
    }
    const ds = r.mediaItem.detailedSeries;
    if (ds && !result.seriesInfo) {
      result.seriesInfo = {
        seriesName: ds.seriesName,
        readingOrder: ds.readingOrder,
      };
    }
    if (result.coverUrl && result.seriesInfo) break;
  }

  return result;
}
