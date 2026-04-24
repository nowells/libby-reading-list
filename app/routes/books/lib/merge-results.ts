import type { BookAvailability } from "~/lib/libby";

/** Merge availability results from multiple libraries into one, deduplicating. */
export function mergeAvailabilityResults(
  allResults: BookAvailability[],
  bookTitle: string,
  bookAuthor: string,
): BookAvailability {
  const merged: BookAvailability = {
    bookTitle,
    bookAuthor,
    results: [],
  };

  for (const result of allResults) {
    merged.results.push(...result.results);
    if (!merged.coverUrl && result.coverUrl) {
      merged.coverUrl = result.coverUrl;
    }
    if (!merged.seriesInfo && result.seriesInfo) {
      merged.seriesInfo = result.seriesInfo;
    }
  }

  // Deduplicate by library+mediaItem (keep unique per library)
  const seen = new Set<string>();
  merged.results = merged.results.filter((r) => {
    const key = `${r.libraryKey}:${r.mediaItem.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  merged.results.sort((a, b) => b.matchScore - a.matchScore);
  return merged;
}

/** Compute oldest fetchedAt timestamp from an availability map. */
export function computeOldestFetchedAt(map: Record<string, { fetchedAt?: number }>): number | null {
  let oldest: number | null = null;
  for (const s of Object.values(map)) {
    if (s.fetchedAt && (oldest === null || s.fetchedAt < oldest)) {
      oldest = s.fetchedAt;
    }
  }
  return oldest;
}
