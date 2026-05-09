import { useEffect, useState } from "react";
import { searchLibrary, type LibbyMediaItem } from "~/lib/libby";
import { resolveWorkIdByTitleAuthor, type SeriesBook } from "~/lib/openlibrary";
import type { LibraryConfig } from "~/lib/storage";
import {
  extractLibbySeriesBooks,
  libbyCandidateToSeriesBook,
  mergeLibbyAndOlSeries,
  sortByReadingOrder,
  type LibbySeriesCandidate,
  type SeriesBookEnriched,
} from "../lib/series-enrichment";

interface UseSeriesEnrichedResult {
  books: SeriesBookEnriched[];
  enriching: boolean;
}

const WORKID_RESOLVE_CONCURRENCY = 5;

function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build the "More in this series" list with Libby (OverDrive) as the
 * primary source of truth. OL's `series:` index covers a fraction of
 * Libby's catalog — for series like Penny's Gamache books, a Libby
 * search for the series name returns every entry while OL returns at
 * most a handful — so we ground the list in Libby and use OL only to:
 *   1. Resolve workIds for Libby books, so cards link into our app, and
 *   2. Append any books OL knows about that aren't in any of the user's
 *      libraries (rare, mostly out-of-print spinoffs).
 *
 * Loading is two-phase so the user sees the catalog as soon as Libby
 * answers; workIds backfill in a second pass without blocking render.
 */
export function useSeriesEnriched(
  olSeriesBooks: SeriesBook[],
  seriesName: string | null,
  libraries: LibraryConfig[],
): UseSeriesEnrichedResult {
  const [enriched, setEnriched] = useState<SeriesBookEnriched[]>(() =>
    sortByReadingOrder(olSeriesBooks),
  );
  const [enriching, setEnriching] = useState(false);

  useEffect(() => {
    setEnriched(sortByReadingOrder(olSeriesBooks));
    if (!seriesName) {
      setEnriching(false);
      return;
    }
    if (libraries.length === 0) {
      // No Libby data available — render OL-only list as-is.
      setEnriching(false);
      return;
    }

    let cancelled = false;
    setEnriching(true);

    (async () => {
      // Phase 1: query Libby for the series name in each library.
      const itemsByLibrary: { libraryKey: string; items: LibbyMediaItem[] }[] = await Promise.all(
        libraries.map(async (lib) => {
          try {
            const items = await searchLibrary(lib.key, seriesName);
            return { libraryKey: lib.key, items };
          } catch {
            return { libraryKey: lib.key, items: [] };
          }
        }),
      );
      if (cancelled) return;

      // Phase 2: build the Libby-primary list, render immediately.
      const candidates = extractLibbySeriesBooks(itemsByLibrary, seriesName);
      const libbyBooks = candidates.map((c) => libbyCandidateToSeriesBook(c, seriesName));
      const merged = mergeLibbyAndOlSeries(libbyBooks, olSeriesBooks);
      setEnriched(sortByReadingOrder(merged));

      // Phase 3: resolve workIds for Libby-only entries (concurrency-bounded)
      // so each card becomes navigable into /book/<workId>.
      const needsResolve: { candidate: LibbySeriesCandidate; titleKey: string }[] = [];
      const olWorkIdByTitle = new Map<string, string>();
      for (const ol of olSeriesBooks) {
        olWorkIdByTitle.set(normalizeTitleKey(ol.title), ol.workId);
      }
      for (const c of candidates) {
        const titleKey = normalizeTitleKey(c.title);
        if (olWorkIdByTitle.has(titleKey)) continue;
        if (!c.author) continue;
        needsResolve.push({ candidate: c, titleKey });
      }

      const resolvedByTitle = new Map<string, string>();
      let cursor = 0;
      async function worker() {
        while (cursor < needsResolve.length) {
          const idx = cursor++;
          const { candidate, titleKey } = needsResolve[idx];
          try {
            const workId = await resolveWorkIdByTitleAuthor(candidate.title, candidate.author!);
            if (workId) resolvedByTitle.set(titleKey, workId);
          } catch {
            // best-effort — leave workId empty
          }
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(WORKID_RESOLVE_CONCURRENCY, needsResolve.length) }, worker),
      );
      if (cancelled) return;

      // Phase 4: re-emit with workIds folded in.
      const finalBooks = candidates.map((c) => {
        const titleKey = normalizeTitleKey(c.title);
        const wid = olWorkIdByTitle.get(titleKey) ?? resolvedByTitle.get(titleKey) ?? "";
        return libbyCandidateToSeriesBook(c, seriesName, wid);
      });
      const finalMerged = mergeLibbyAndOlSeries(finalBooks, olSeriesBooks);
      setEnriched(sortByReadingOrder(finalMerged));
      setEnriching(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [olSeriesBooks, seriesName, libraries]);

  return { books: enriched, enriching };
}
