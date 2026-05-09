import type { LibbyMediaItem } from "~/lib/libby";
import type { SeriesBook } from "~/lib/openlibrary";

export interface SeriesAvailability {
  /** Best reading order from Libby's detailedSeries field, when present. */
  readingOrder?: string;
  /** True if at least one matched Libby copy is available right now. */
  isAvailable: boolean;
  /** Shortest estimated wait days across matched copies (undefined when none). */
  estimatedWaitDays?: number;
  /** Distinct format types available (e.g. "ebook", "audiobook"). */
  formats: string[];
  /** Best library key + media id for deep-linking into Libby. */
  bestLibraryKey?: string;
  bestMediaId?: string;
  /** True when at least one library returned a hit for this title. */
  inLibrary: boolean;
}

export interface SeriesBookEnriched extends SeriesBook {
  availability?: SeriesAvailability;
}

/** Normalize a title for fuzzy matching across OL and Libby. */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface LibbySeriesItem {
  libraryKey: string;
  item: LibbyMediaItem;
}

/**
 * Match an OL series book to one or more Libby items by normalized title.
 * Libby tends to return distinct editions (audio, kindle, epub) so we
 * accept many items per book and aggregate their formats / availability.
 */
function findLibbyMatches(
  book: SeriesBook,
  byTitle: Map<string, LibbySeriesItem[]>,
): LibbySeriesItem[] {
  const norm = normalizeTitle(book.title);
  if (!norm) return [];
  // Exact normalized hit first.
  const exact = byTitle.get(norm);
  if (exact && exact.length > 0) return exact;
  // Fall back to contains-either, which catches subtitle drift like
  // "Title" vs "Title: A Subtitle". Cap at 1 hit to avoid mismatching
  // sibling books in the same series.
  for (const [key, items] of byTitle) {
    if (key.includes(norm) || norm.includes(key)) {
      return items;
    }
  }
  return [];
}

/**
 * Build the per-title index from Libby search results across libraries.
 * Each Libby item ends up under the key derived from its sortTitle.
 */
export function buildLibbyTitleIndex(
  itemsByLibrary: { libraryKey: string; items: LibbyMediaItem[] }[],
): Map<string, LibbySeriesItem[]> {
  const out = new Map<string, LibbySeriesItem[]>();
  for (const { libraryKey, items } of itemsByLibrary) {
    for (const item of items) {
      const key = normalizeTitle(item.sortTitle || item.title);
      if (!key) continue;
      const arr = out.get(key) ?? [];
      arr.push({ libraryKey, item });
      out.set(key, arr);
    }
  }
  return out;
}

/**
 * Roll up the matched Libby items for a single OL series book into one
 * compact availability summary the UI can render at-a-glance.
 */
export function summarizeAvailability(
  matches: LibbySeriesItem[],
  seriesNameLower: string,
): SeriesAvailability {
  if (matches.length === 0) {
    return { isAvailable: false, formats: [], inLibrary: false };
  }

  const formatSet = new Set<string>();
  let isAvailable = false;
  let bestEta: number | undefined;
  let bestLibraryKey: string | undefined;
  let bestMediaId: string | undefined;
  let readingOrder: string | undefined;

  for (const { libraryKey, item } of matches) {
    const formatType = item.type?.id ?? "unknown";
    formatSet.add(formatType);

    if (item.detailedSeries?.seriesName?.toLowerCase() === seriesNameLower && !readingOrder) {
      readingOrder = item.detailedSeries.readingOrder;
    }

    const itemAvailable = item.isAvailable ?? (item.availableCopies ?? 0) > 0;
    if (itemAvailable) {
      if (!isAvailable) {
        isAvailable = true;
        bestLibraryKey = libraryKey;
        bestMediaId = item.id;
      }
      continue;
    }
    const wait = item.estimatedWaitDays;
    if (wait != null && (bestEta === undefined || wait < bestEta)) {
      bestEta = wait;
      if (!isAvailable) {
        bestLibraryKey = libraryKey;
        bestMediaId = item.id;
      }
    }
  }

  return {
    readingOrder,
    isAvailable,
    estimatedWaitDays: isAvailable ? 0 : bestEta,
    formats: Array.from(formatSet),
    bestLibraryKey,
    bestMediaId,
    inLibrary: true,
  };
}

/**
 * Merge OL series books with Libby search results. A single Libby search
 * per library returns the whole series, so this is bounded at ~N libraries
 * regardless of how many books are in the series.
 */
export function mergeSeriesWithLibby(
  books: SeriesBook[],
  itemsByLibrary: { libraryKey: string; items: LibbyMediaItem[] }[],
  seriesName: string,
): SeriesBookEnriched[] {
  const index = buildLibbyTitleIndex(itemsByLibrary);
  const seriesNameLower = seriesName.toLowerCase();
  return books.map((book) => {
    const matches = findLibbyMatches(book, index);
    const availability = summarizeAvailability(matches, seriesNameLower);
    return {
      ...book,
      // Libby's readingOrder is more authoritative than the one we may have
      // parsed from OL's `series` field.
      readingOrder: availability.readingOrder ?? book.readingOrder,
      availability,
    };
  });
}

/** Sort enriched series books by reading order, with year as a fallback. */
export function sortByReadingOrder(books: SeriesBookEnriched[]): SeriesBookEnriched[] {
  return [...books].sort((a, b) => {
    const ao = parseFloat(a.readingOrder ?? "");
    const bo = parseFloat(b.readingOrder ?? "");
    const aHas = Number.isFinite(ao);
    const bHas = Number.isFinite(bo);
    if (aHas && bHas && ao !== bo) return ao - bo;
    if (aHas !== bHas) return aHas ? -1 : 1;
    return (a.firstPublishYear ?? 9999) - (b.firstPublishYear ?? 9999);
  });
}
