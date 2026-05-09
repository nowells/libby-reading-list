import { useEffect, useState } from "react";
import { searchLibrary, type LibbyMediaItem } from "~/lib/libby";
import type { SeriesBook } from "~/lib/openlibrary";
import type { LibraryConfig } from "~/lib/storage";
import {
  mergeSeriesWithLibby,
  sortByReadingOrder,
  type SeriesBookEnriched,
} from "../lib/series-enrichment";

interface UseSeriesEnrichedResult {
  books: SeriesBookEnriched[];
  enriching: boolean;
}

/**
 * Enrich the OL-derived series book list with Libby data: a single Libby
 * search per library on the series name returns the whole series with
 * `detailedSeries.readingOrder` and per-edition availability, which we
 * fold into each base book. Libby errors are non-fatal — the OL data is
 * still rendered, just without availability.
 */
export function useSeriesEnriched(
  baseBooks: SeriesBook[],
  seriesName: string | null,
  libraries: LibraryConfig[],
): UseSeriesEnrichedResult {
  const [enriched, setEnriched] = useState<SeriesBookEnriched[]>(() =>
    sortByReadingOrder(baseBooks),
  );
  const [enriching, setEnriching] = useState(false);

  useEffect(() => {
    setEnriched(sortByReadingOrder(baseBooks));
    if (!seriesName || baseBooks.length === 0 || libraries.length === 0) {
      setEnriching(false);
      return;
    }

    let cancelled = false;
    setEnriching(true);

    (async () => {
      const itemsByLibrary: { libraryKey: string; items: LibbyMediaItem[] }[] = [];
      for (const lib of libraries) {
        try {
          const items = await searchLibrary(lib.key, seriesName);
          itemsByLibrary.push({ libraryKey: lib.key, items });
        } catch {
          // Skip library errors — this is best-effort enrichment.
        }
        if (cancelled) return;
      }
      if (cancelled) return;
      const merged = mergeSeriesWithLibby(baseBooks, itemsByLibrary, seriesName);
      setEnriched(sortByReadingOrder(merged));
      setEnriching(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [baseBooks, seriesName, libraries]);

  return { books: enriched, enriching };
}
