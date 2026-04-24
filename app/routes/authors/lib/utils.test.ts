import { describe, it, expect } from "vitest";
import {
  extractAvailability,
  getFormatType,
  normalizeTitle,
  dedupeWorks,
  sortAuthorWorks,
  dedupeLibbyResults,
} from "./utils";
import type { LibbyMediaItem } from "~/lib/libby";
import type { AuthorBookResult, LibbyFormatResult } from "../hooks/use-author-availability";

function makeMediaItem(overrides: Partial<LibbyMediaItem> = {}): LibbyMediaItem {
  return {
    id: "item-1",
    title: "Test Book",
    sortTitle: "test book",
    type: { id: "ebook-kindle", name: "eBook" },
    formats: [],
    creators: [{ name: "Jane Author", role: "Author" }],
    ...overrides,
  };
}

function makeWork(overrides: Partial<AuthorBookResult> = {}): AuthorBookResult {
  return {
    title: "A Book",
    olWorkKey: "/works/OL123W",
    libbyResults: [],
    ...overrides,
  };
}

function makeLibbyResult(overrides: Partial<LibbyFormatResult> = {}): LibbyFormatResult {
  const item = makeMediaItem();
  return {
    mediaItem: item,
    availability: extractAvailability(item),
    formatType: "ebook",
    libraryKey: "lapl",
    ...overrides,
  };
}

describe("extractAvailability", () => {
  it("extracts fields from a media item with all fields", () => {
    const item = makeMediaItem({
      id: "42",
      ownedCopies: 5,
      availableCopies: 2,
      holdsCount: 3,
      isAvailable: true,
      estimatedWaitDays: 7,
    });
    const result = extractAvailability(item);
    expect(result).toEqual({
      id: "42",
      copiesOwned: 5,
      copiesAvailable: 2,
      numberOfHolds: 3,
      isAvailable: true,
      estimatedWaitDays: 7,
    });
  });

  it("defaults missing numeric fields to 0", () => {
    const item = makeMediaItem({ id: "99" });
    const result = extractAvailability(item);
    expect(result.copiesOwned).toBe(0);
    expect(result.copiesAvailable).toBe(0);
    expect(result.numberOfHolds).toBe(0);
  });

  it("derives isAvailable from availableCopies when not explicitly set", () => {
    const available = makeMediaItem({ isAvailable: undefined, availableCopies: 1 });
    expect(extractAvailability(available).isAvailable).toBe(true);

    const unavailable = makeMediaItem({ isAvailable: undefined, availableCopies: 0 });
    expect(extractAvailability(unavailable).isAvailable).toBe(false);

    const noData = makeMediaItem({ isAvailable: undefined });
    expect(extractAvailability(noData).isAvailable).toBe(false);
  });

  it("preserves estimatedWaitDays as undefined when not set", () => {
    const item = makeMediaItem();
    expect(extractAvailability(item).estimatedWaitDays).toBeUndefined();
  });
});

describe("getFormatType", () => {
  it("returns 'audiobook' when type id contains audiobook", () => {
    expect(getFormatType(makeMediaItem({ type: { id: "audiobook-mp3", name: "Audiobook" } }))).toBe(
      "audiobook",
    );
  });

  it("returns 'ebook' for non-audiobook types", () => {
    expect(getFormatType(makeMediaItem({ type: { id: "ebook-kindle", name: "eBook" } }))).toBe(
      "ebook",
    );
    expect(getFormatType(makeMediaItem({ type: { id: "magazine", name: "Magazine" } }))).toBe(
      "ebook",
    );
  });

  it("returns 'ebook' when type is missing", () => {
    const item = makeMediaItem();
    // @ts-expect-error testing missing type
    item.type = undefined;
    expect(getFormatType(item)).toBe("ebook");
  });
});

describe("normalizeTitle", () => {
  it("lowercases text", () => {
    expect(normalizeTitle("THE GREAT GATSBY")).toBe("the great gatsby");
  });

  it("strips punctuation", () => {
    expect(normalizeTitle("Hello, World!")).toBe("hello world");
  });

  it("collapses multiple spaces", () => {
    expect(normalizeTitle("hello   world")).toBe("hello world");
  });

  it("trims leading/trailing whitespace", () => {
    expect(normalizeTitle("  hello  ")).toBe("hello");
  });

  it("handles apostrophes and hyphens", () => {
    expect(normalizeTitle("It's a Well-Known Fact")).toBe("its a wellknown fact");
  });

  it("handles empty string", () => {
    expect(normalizeTitle("")).toBe("");
  });

  it("preserves numbers", () => {
    expect(normalizeTitle("Catch-22")).toBe("catch22");
  });
});

describe("dedupeWorks", () => {
  it("returns empty array for empty input", () => {
    expect(dedupeWorks([])).toEqual([]);
  });

  it("keeps unique works", () => {
    const works = [makeWork({ title: "Book A" }), makeWork({ title: "Book B" })];
    expect(dedupeWorks(works)).toHaveLength(2);
  });

  it("deduplicates by normalized title", () => {
    const works = [
      makeWork({ title: "The Great Gatsby" }),
      makeWork({ title: "the great gatsby" }),
    ];
    expect(dedupeWorks(works)).toHaveLength(1);
  });

  it("deduplicates titles differing only in punctuation", () => {
    const works = [makeWork({ title: "It's Here!" }), makeWork({ title: "Its Here" })];
    expect(dedupeWorks(works)).toHaveLength(1);
  });

  it("prefers the work with more libby results", () => {
    const fewer = makeWork({
      title: "Book A",
      libbyResults: [makeLibbyResult()],
    });
    const more = makeWork({
      title: "Book A",
      libbyResults: [makeLibbyResult(), makeLibbyResult({ libraryKey: "nypl" })],
    });
    const result = dedupeWorks([fewer, more]);
    expect(result).toHaveLength(1);
    expect(result[0].libbyResults).toHaveLength(2);
  });

  it("prefers earlier publish year on tie", () => {
    const older = makeWork({ title: "Book A", firstPublishYear: 1990 });
    const newer = makeWork({ title: "Book A", firstPublishYear: 2020 });
    const result = dedupeWorks([newer, older]);
    expect(result[0].firstPublishYear).toBe(1990);
  });

  it("prefers work with cover when results tied and existing has no cover", () => {
    const noCover = makeWork({ title: "Book A", coverId: undefined });
    const hasCover = makeWork({ title: "Book A", coverId: 12345 });
    const result = dedupeWorks([noCover, hasCover]);
    expect(result[0].coverId).toBe(12345);
  });

  it("keeps existing when it already has a cover (cover tiebreak doesn't replace)", () => {
    const hasCover = makeWork({ title: "Book A", coverId: 111 });
    const alsoCover = makeWork({ title: "Book A", coverId: 222 });
    const result = dedupeWorks([hasCover, alsoCover]);
    expect(result[0].coverId).toBe(111);
  });

  it("prefers undefined publish year over Infinity (both undefined)", () => {
    const a = makeWork({ title: "Book A", firstPublishYear: undefined });
    const b = makeWork({ title: "Book A", firstPublishYear: undefined });
    const result = dedupeWorks([a, b]);
    expect(result).toHaveLength(1);
  });
});

describe("sortAuthorWorks", () => {
  it("puts works with libby results first", () => {
    const noResults = makeWork({ title: "No Results" });
    const hasResults = makeWork({
      title: "Has Results",
      libbyResults: [makeLibbyResult()],
    });
    const sorted = sortAuthorWorks([noResults, hasResults]);
    expect(sorted[0].title).toBe("Has Results");
    expect(sorted[1].title).toBe("No Results");
  });

  it("sorts by year descending among same-tier works", () => {
    const old = makeWork({ title: "Old", firstPublishYear: 1990 });
    const recent = makeWork({ title: "Recent", firstPublishYear: 2020 });
    const mid = makeWork({ title: "Mid", firstPublishYear: 2005 });
    const sorted = sortAuthorWorks([old, mid, recent]);
    expect(sorted.map((w) => w.title)).toEqual(["Recent", "Mid", "Old"]);
  });

  it("does not mutate the original array", () => {
    const works = [
      makeWork({ title: "B", firstPublishYear: 1990 }),
      makeWork({ title: "A", firstPublishYear: 2020 }),
    ];
    const original = [...works];
    sortAuthorWorks(works);
    expect(works[0].title).toBe(original[0].title);
  });

  it("treats undefined year as 0 (sorts last)", () => {
    const noYear = makeWork({ title: "No Year" });
    const hasYear = makeWork({ title: "Has Year", firstPublishYear: 2020 });
    const sorted = sortAuthorWorks([noYear, hasYear]);
    expect(sorted[0].title).toBe("Has Year");
  });
});

describe("dedupeLibbyResults", () => {
  it("removes duplicates by library+mediaItem id", () => {
    const r1 = makeLibbyResult({ libraryKey: "lapl", mediaItem: makeMediaItem({ id: "1" }) });
    const r2 = makeLibbyResult({ libraryKey: "lapl", mediaItem: makeMediaItem({ id: "1" }) });
    const r3 = makeLibbyResult({ libraryKey: "nypl", mediaItem: makeMediaItem({ id: "1" }) });
    expect(dedupeLibbyResults([r1, r2, r3])).toHaveLength(2);
  });

  it("keeps first occurrence", () => {
    const r1 = makeLibbyResult({
      libraryKey: "lapl",
      mediaItem: makeMediaItem({ id: "1" }),
      formatType: "ebook",
    });
    const r2 = makeLibbyResult({
      libraryKey: "lapl",
      mediaItem: makeMediaItem({ id: "1" }),
      formatType: "audiobook",
    });
    const result = dedupeLibbyResults([r1, r2]);
    expect(result[0].formatType).toBe("ebook");
  });

  it("returns empty array for empty input", () => {
    expect(dedupeLibbyResults([])).toEqual([]);
  });
});
