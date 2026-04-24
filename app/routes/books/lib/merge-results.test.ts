import { describe, it, expect } from "vitest";
import { mergeAvailabilityResults, computeOldestFetchedAt } from "./merge-results";
import type { BookAvailability, BookAvailabilityResult, LibbyMediaItem } from "~/lib/libby";

function makeMediaItem(id: string): LibbyMediaItem {
  return {
    id,
    title: "Test",
    sortTitle: "test",
    type: { id: "ebook", name: "eBook" },
    formats: [],
    creators: [],
  };
}

function makeResult(
  libraryKey: string,
  mediaItemId: string,
  matchScore: number,
): BookAvailabilityResult {
  return {
    mediaItem: makeMediaItem(mediaItemId),
    availability: {
      id: mediaItemId,
      copiesOwned: 1,
      copiesAvailable: 0,
      numberOfHolds: 2,
      isAvailable: false,
    },
    matchScore,
    formatType: "ebook",
    libraryKey,
  };
}

function makeAvailability(
  results: BookAvailabilityResult[],
  extras: Partial<BookAvailability> = {},
): BookAvailability {
  return {
    bookTitle: "Test Book",
    bookAuthor: "Test Author",
    results,
    ...extras,
  };
}

describe("mergeAvailabilityResults", () => {
  it("merges results from multiple libraries", () => {
    const lib1 = makeAvailability([makeResult("lapl", "1", 80)]);
    const lib2 = makeAvailability([makeResult("nypl", "2", 90)]);
    const merged = mergeAvailabilityResults([lib1, lib2], "Book", "Author");
    expect(merged.results).toHaveLength(2);
    expect(merged.bookTitle).toBe("Book");
    expect(merged.bookAuthor).toBe("Author");
  });

  it("deduplicates by library+mediaItem id", () => {
    const lib1 = makeAvailability([makeResult("lapl", "1", 80), makeResult("lapl", "1", 70)]);
    const merged = mergeAvailabilityResults([lib1], "Book", "Author");
    expect(merged.results).toHaveLength(1);
  });

  it("allows same mediaItem id from different libraries", () => {
    const lib1 = makeAvailability([makeResult("lapl", "1", 80)]);
    const lib2 = makeAvailability([makeResult("nypl", "1", 90)]);
    const merged = mergeAvailabilityResults([lib1, lib2], "Book", "Author");
    expect(merged.results).toHaveLength(2);
  });

  it("sorts results by matchScore descending", () => {
    const lib1 = makeAvailability([makeResult("lapl", "1", 60)]);
    const lib2 = makeAvailability([makeResult("nypl", "2", 90)]);
    const lib3 = makeAvailability([makeResult("sfpl", "3", 75)]);
    const merged = mergeAvailabilityResults([lib1, lib2, lib3], "Book", "Author");
    expect(merged.results.map((r) => r.matchScore)).toEqual([90, 75, 60]);
  });

  it("takes first coverUrl found", () => {
    const lib1 = makeAvailability([], { coverUrl: undefined });
    const lib2 = makeAvailability([], { coverUrl: "https://example.com/cover.jpg" });
    const lib3 = makeAvailability([], { coverUrl: "https://example.com/other.jpg" });
    const merged = mergeAvailabilityResults([lib1, lib2, lib3], "Book", "Author");
    expect(merged.coverUrl).toBe("https://example.com/cover.jpg");
  });

  it("takes first seriesInfo found", () => {
    const lib1 = makeAvailability([]);
    const lib2 = makeAvailability([], {
      seriesInfo: { seriesName: "Series A", readingOrder: "1" },
    });
    const merged = mergeAvailabilityResults([lib1, lib2], "Book", "Author");
    expect(merged.seriesInfo?.seriesName).toBe("Series A");
  });

  it("handles empty input", () => {
    const merged = mergeAvailabilityResults([], "Book", "Author");
    expect(merged.results).toEqual([]);
    expect(merged.bookTitle).toBe("Book");
  });

  it("handles single library with no results", () => {
    const lib = makeAvailability([]);
    const merged = mergeAvailabilityResults([lib], "Book", "Author");
    expect(merged.results).toEqual([]);
  });
});

describe("computeOldestFetchedAt", () => {
  it("returns null for empty map", () => {
    expect(computeOldestFetchedAt({})).toBeNull();
  });

  it("returns null when no entries have fetchedAt", () => {
    expect(computeOldestFetchedAt({ a: {}, b: {} })).toBeNull();
  });

  it("returns the single fetchedAt value", () => {
    expect(computeOldestFetchedAt({ a: { fetchedAt: 1000 } })).toBe(1000);
  });

  it("returns the oldest fetchedAt", () => {
    const map = {
      a: { fetchedAt: 3000 },
      b: { fetchedAt: 1000 },
      c: { fetchedAt: 2000 },
    };
    expect(computeOldestFetchedAt(map)).toBe(1000);
  });

  it("ignores entries without fetchedAt", () => {
    const map = {
      a: {},
      b: { fetchedAt: 5000 },
      c: {},
    };
    expect(computeOldestFetchedAt(map)).toBe(5000);
  });
});
