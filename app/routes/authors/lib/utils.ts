import type { LibbyMediaItem, AvailabilityInfo } from "~/lib/libby";
import type { AuthorBookResult, LibbyFormatResult } from "../hooks/use-author-availability";

export function extractAvailability(item: LibbyMediaItem): AvailabilityInfo {
  return {
    id: item.id,
    copiesOwned: item.ownedCopies ?? 0,
    copiesAvailable: item.availableCopies ?? 0,
    numberOfHolds: item.holdsCount ?? 0,
    isAvailable: item.isAvailable ?? (item.availableCopies ?? 0) > 0,
    estimatedWaitDays: item.estimatedWaitDays,
  };
}

export function getFormatType(item: LibbyMediaItem): string {
  const typeId = item.type?.id ?? "";
  if (typeId.includes("audiobook")) return "audiobook";
  return "ebook";
}

/** Normalize title for dedup comparison. */
export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Deduplicate works by normalized title, keeping the one with more libby results or earlier publish year. */
export function dedupeWorks(works: AuthorBookResult[]): AuthorBookResult[] {
  const map = new Map<string, AuthorBookResult>();
  for (const w of works) {
    const key = normalizeTitle(w.title);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, w);
    } else {
      // Prefer the one with more libby results; tie-break by earlier publish year, then cover
      if (
        w.libbyResults.length > existing.libbyResults.length ||
        (w.libbyResults.length === existing.libbyResults.length &&
          (w.firstPublishYear ?? Infinity) < (existing.firstPublishYear ?? Infinity)) ||
        (w.libbyResults.length === existing.libbyResults.length && !existing.coverId && w.coverId)
      ) {
        map.set(key, w);
      }
    }
  }
  return [...map.values()];
}

/** Sort author works: books with availability first, then by year descending. */
export function sortAuthorWorks(works: AuthorBookResult[]): AuthorBookResult[] {
  const sorted = [...works];
  sorted.sort((a, b) => {
    const aHas = a.libbyResults.length > 0 ? 1 : 0;
    const bHas = b.libbyResults.length > 0 ? 1 : 0;
    if (bHas !== aHas) return bHas - aHas;
    const ya = a.firstPublishYear ?? 0;
    const yb = b.firstPublishYear ?? 0;
    return yb - ya;
  });
  return sorted;
}

/** Deduplicate libby results by library+mediaItem id. */
export function dedupeLibbyResults(results: LibbyFormatResult[]): LibbyFormatResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = `${r.libraryKey}:${r.mediaItem.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
