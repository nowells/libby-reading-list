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
  /** Libby-supplied cover URL — used when no OL coverId is known. */
  coverUrl?: string;
}

/** Normalize a title for fuzzy matching across OL and Libby. */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * "Core" form of a title used to match editions of the same book against
 * each other. Reduce to the bare title by:
 *   1. Stripping any parenthetical or bracketed segment ("(Audiobook)",
 *      "[Unabridged]", "(Chief Inspector Gamache Series #1)").
 *   2. Cutting off everything after the first subtitle separator —
 *      ":", " — ", " – ", " - ", or ", " — so "Still Life: A Chief
 *      Inspector Gamache Novel", "The Beautiful Mystery, Book 8", and
 *      "Still Life - Unabridged" all reduce to the same key as the
 *      bare title.
 *   3. Lowercasing + stripping non-alphanumeric.
 *   4. Stripping leading or trailing articles ("the", "a", "an") so
 *      "The Beautiful Mystery" and the title-sorted "Beautiful
 *      Mystery, The" collapse.
 *
 * Bias is toward over-collapsing within a single series; the caller
 * already filters Libby items to the target series, so cross-series
 * collisions can't happen.
 */
function coreTitle(title: string): string {
  let t = title.replace(/[([][^)\]]*[)\]]/g, " ");
  // Subtitle / edition-marker separators. Comma-space is included to
  // catch "Beautiful Mystery, Book 8" and the sortTitle quirk
  // "Beautiful Mystery, The". Hyphen variants must be flanked by
  // whitespace so we don't break hyphenated titles like
  // "Twenty-Twenty".
  t = t.split(/:|\s[—–-]\s|,\s/)[0];
  let normalized = normalizeTitle(t);
  normalized = normalized.replace(/^(the|a|an)\s+/, "");
  normalized = normalized.replace(/\s+(the|a|an)$/, "");
  return normalized;
}

/** Extract a 4-digit year from a Libby publishDate like "2018-11-27". */
function parseYear(date?: string): number | undefined {
  if (!date) return undefined;
  const m = date.match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : undefined;
}

/** Last name from a "Firstname Lastname" string, lowercased. Empty string when missing. */
function authorLast(name: string | undefined): string {
  if (!name) return "";
  const last = name.toLowerCase().trim().split(/\s+/).pop();
  return last ?? "";
}

/**
 * Treat the Libby and target series names as the same when one contains
 * the other (case-insensitive). Catches drift like "Murderbot" vs
 * "Murderbot Diaries" or trailing "Series" suffixes that don't show up
 * consistently across editions.
 */
export function seriesNameMatches(itemSeries: string, target: string): boolean {
  const a = itemSeries.toLowerCase().trim();
  const b = target.toLowerCase().trim();
  if (!a || !b) return false;
  if (a === b) return true;
  return a.includes(b) || b.includes(a);
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

    if (
      item.detailedSeries?.seriesName &&
      seriesNameMatches(item.detailedSeries.seriesName, seriesNameLower) &&
      !readingOrder
    ) {
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
 * One unique book in a series, derived from Libby search results across
 * one or more libraries. Libby's `detailedSeries` covers a far more
 * complete catalog than OL's `series:` index — for many series, Libby
 * sees every entry while OL sees a fraction — so we treat Libby as the
 * primary source of "what books are in this series" and fall back to
 * OL only as a supplement for books not in any of the user's libraries.
 */
export interface LibbySeriesCandidate {
  /** Best title from Libby. */
  title: string;
  /** Author name extracted from Libby creators (role: "Author"). */
  author?: string;
  /** Reading order from detailedSeries.readingOrder (e.g. "1", "5.5"). */
  readingOrder?: string;
  /** Cover URL from the best matched edition. */
  coverUrl?: string;
  /** Year parsed from publishDate, when available. */
  firstPublishYear?: number;
  /** All matches across libraries — drives the availability summary. */
  matches: LibbySeriesItem[];
}

/**
 * Build the dedup keys for one Libby item within a single series. Reading
 * order is the strongest signal we have — every edition of "Still Life"
 * (#1) shares `detailedSeries.readingOrder = "1"` regardless of whether
 * the format is ebook/audio/large-print or whether the title field
 * happens to include the subtitle ("Still Life" vs "Still Life: A
 * Chief Inspector Gamache Novel"). But Libby is inconsistent: some
 * editions of the same book come back with `readingOrder` populated
 * and others don't. Returning *both* keys (when available) lets the
 * caller index the candidate under each, so a later edition that
 * matches on either key collapses into the existing candidate
 * instead of spawning a duplicate.
 */
function libbyItemDedupKeys(item: LibbyMediaItem): string[] {
  const keys: string[] = [];
  const ro = item.detailedSeries?.readingOrder?.trim();
  if (ro) keys.push(`order:${ro}`);
  // Use the "core" title (subtitle + parens stripped) so editions whose
  // sortTitle baked the subtitle in still collapse with the bare title.
  // The display form lives on the candidate; this is just the dedup key.
  const titleKey = coreTitle(item.title) || normalizeTitle(item.sortTitle || item.title);
  if (titleKey) keys.push(`title:${titleKey}`);
  return keys;
}

/**
 * Pull all unique books for the given series out of Libby search results.
 * Filters to items whose `detailedSeries.seriesName` matches the target,
 * groups by reading-order *and* normalized-title fallback so multiple
 * editions / formats / libraries collapse into one candidate even when
 * Libby returns inconsistent readingOrder coverage across editions.
 */
export function extractLibbySeriesBooks(
  itemsByLibrary: { libraryKey: string; items: LibbyMediaItem[] }[],
  seriesName: string,
): LibbySeriesCandidate[] {
  // A candidate may be reachable by several keys (its order key plus its
  // title key); we look it up by any of them and keep the same object
  // referenced under each so later items match in either direction.
  const byKey = new Map<string, LibbySeriesCandidate>();
  const all: LibbySeriesCandidate[] = [];

  for (const { libraryKey, items } of itemsByLibrary) {
    for (const item of items) {
      const itemSeriesName = item.detailedSeries?.seriesName;
      if (!itemSeriesName || !seriesNameMatches(itemSeriesName, seriesName)) continue;

      const keys = libbyItemDedupKeys(item);
      if (keys.length === 0) continue;

      // Find an existing candidate via any of this item's keys.
      let existing: LibbySeriesCandidate | undefined;
      for (const k of keys) {
        const hit = byKey.get(k);
        if (hit) {
          existing = hit;
          break;
        }
      }

      if (existing) {
        existing.matches.push({ libraryKey, item });
        if (!existing.coverUrl && item.covers?.cover150Wide?.href) {
          existing.coverUrl = item.covers.cover150Wide.href;
        }
        if (!existing.readingOrder && item.detailedSeries?.readingOrder) {
          existing.readingOrder = item.detailedSeries.readingOrder;
        }
        if (!existing.firstPublishYear) {
          existing.firstPublishYear = parseYear(item.publishDate);
        }
        // Prefer the shortest title across editions (typically the canonical
        // form without subtitle / "Unabridged" / etc).
        if (item.title && item.title.length < existing.title.length) {
          existing.title = item.title;
        }
        // Make sure every key this item carries also resolves to the
        // existing candidate so future items match in either direction.
        for (const k of keys) {
          if (!byKey.has(k)) byKey.set(k, existing);
        }
      } else {
        const author = item.creators?.find((c) => c.role === "Author")?.name;
        const candidate: LibbySeriesCandidate = {
          title: item.title,
          author,
          readingOrder: item.detailedSeries?.readingOrder,
          coverUrl: item.covers?.cover150Wide?.href,
          firstPublishYear: parseYear(item.publishDate),
          matches: [{ libraryKey, item }],
        };
        for (const k of keys) byKey.set(k, candidate);
        all.push(candidate);
      }
    }
  }

  return all;
}

/**
 * Convert one Libby candidate into a SeriesBookEnriched. `workId` defaults
 * to empty so the hook can show the row immediately and fill the workId
 * in later (resolved via OL title+author search) for navigability.
 */
export function libbyCandidateToSeriesBook(
  candidate: LibbySeriesCandidate,
  seriesName: string,
  workId: string = "",
): SeriesBookEnriched {
  return {
    workId,
    title: candidate.title,
    authorName: candidate.author,
    firstPublishYear: candidate.firstPublishYear,
    coverUrl: candidate.coverUrl,
    readingOrder: candidate.readingOrder,
    availability: summarizeAvailability(candidate.matches, seriesName.toLowerCase()),
  };
}

/**
 * Combine the Libby-derived list with OL series-search results.
 * - Libby wins when both have the same book (it has availability + cover).
 * - OL fills in missing workIds, coverIds, publish years on Libby books.
 * - Pure OL hits append to the end (no availability, but they still
 *   render so the user sees the full series).
 *
 * Dedup tries reading-order first (most reliable when both sides have
 * one), then normalized-title equality, then a coreTitle + author
 * fallback so "Still Life" (Libby) and "Still Life: A Chief Inspector
 * Gamache Novel" (OL) collapse instead of stacking up. Reading-order
 * comparison is numeric so "1" and "1.0" resolve as the same book.
 */
export function mergeLibbyAndOlSeries(
  libbyBooks: SeriesBookEnriched[],
  olBooks: SeriesBook[],
): SeriesBookEnriched[] {
  const out = libbyBooks.map((b) => ({ ...b }));
  // Numeric order index — keyed by parseFloat so "1" / "1.0" / " 1 "
  // collapse onto the same bucket.
  const indexByOrder = new Map<number, number>();
  const indexByTitle = new Map<string, number>();
  const indexByCore = new Map<string, number>();

  for (let i = 0; i < out.length; i++) {
    const ro = parseFloat(out[i].readingOrder ?? "");
    if (Number.isFinite(ro)) indexByOrder.set(ro, i);
    indexByTitle.set(normalizeTitle(out[i].title), i);
    const core = coreTitle(out[i].title);
    if (core) {
      const key = `${core}|${authorLast(out[i].authorName)}`;
      indexByCore.set(key, i);
    }
  }

  let mergedCount = 0;
  let appendedCount = 0;

  for (const ol of olBooks) {
    const olOrder = parseFloat(ol.readingOrder ?? "");
    let existingIdx: number | undefined;
    if (Number.isFinite(olOrder)) existingIdx = indexByOrder.get(olOrder);
    if (existingIdx === undefined) {
      existingIdx = indexByTitle.get(normalizeTitle(ol.title));
    }
    if (existingIdx === undefined) {
      const core = coreTitle(ol.title);
      if (core) {
        existingIdx = indexByCore.get(`${core}|${authorLast(ol.authorName)}`);
      }
    }
    if (existingIdx !== undefined) {
      const existing = out[existingIdx];
      out[existingIdx] = {
        ...existing,
        workId: existing.workId || ol.workId,
        coverId: existing.coverId ?? ol.coverId,
        firstPublishYear: existing.firstPublishYear ?? ol.firstPublishYear,
        authorName: existing.authorName ?? ol.authorName,
        readingOrder: existing.readingOrder ?? ol.readingOrder,
      };
      mergedCount++;
      continue;
    }
    if (Number.isFinite(olOrder)) indexByOrder.set(olOrder, out.length);
    indexByTitle.set(normalizeTitle(ol.title), out.length);
    const olCore = coreTitle(ol.title);
    if (olCore) indexByCore.set(`${olCore}|${authorLast(ol.authorName)}`, out.length);
    out.push({
      ...ol,
      availability: { isAvailable: false, formats: [], inLibrary: false },
    });
    appendedCount++;
  }

  if (typeof console !== "undefined") {
    console.info(
      `[series] merge: libby=${libbyBooks.length} ol=${olBooks.length} → out=${out.length} (merged ${mergedCount}, appended ${appendedCount})`,
    );
  }

  return out;
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

/**
 * Legacy: OL-primary merge. Kept for callers that still want OL as the
 * canonical book list. New "More in this series" UI uses Libby-primary
 * via `extractLibbySeriesBooks` + `mergeLibbyAndOlSeries`.
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
      readingOrder: availability.readingOrder ?? book.readingOrder,
      availability,
    };
  });
}
