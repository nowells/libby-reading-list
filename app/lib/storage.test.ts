import { describe, it, expect } from "vitest";
import { mergeImportForSource, type Book } from "./storage";

function book(overrides: Partial<Book> = {}): Book {
  return {
    id: "b",
    title: "Test",
    author: "Author",
    source: "unknown",
    ...overrides,
  };
}

describe("mergeImportForSource", () => {
  it("re-importing one source replaces only that source's books", () => {
    const existing: Book[] = [
      book({ id: "gr-1", source: "goodreads", title: "Old A" }),
      book({ id: "gr-2", source: "goodreads", title: "Old B" }),
      book({ id: "bh-1", source: "bookhive", title: "Bookhive Book" }),
    ];
    const imported: Book[] = [book({ id: "gr-3", source: "goodreads", title: "New C" })];

    const result = mergeImportForSource(existing, imported, "goodreads");

    expect(result.map((b) => b.id).sort()).toEqual(["bh-1", "gr-3"]);
  });

  it("Bookhive entries take precedence over CSV entries for the same work", () => {
    const existing: Book[] = [
      book({
        id: "bh-1",
        source: "bookhive",
        title: "Foundation",
        author: "Asimov",
        workId: "OL1W",
        sourceUrl: "https://bookhive.buzz/books/bk_1",
      }),
    ];
    const imported: Book[] = [
      book({
        id: "gr-9",
        source: "goodreads",
        title: "Foundation",
        author: "Asimov",
        workId: "OL1W",
        isbn13: "9780553293357",
      }),
    ];

    const result = mergeImportForSource(existing, imported, "goodreads");

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("bh-1");
    expect(result[0].source).toBe("bookhive");
    // Filled in from the goodreads side via merge
    expect(result[0].isbn13).toBe("9780553293357");
    // Bookhive's own sourceUrl preserved
    expect(result[0].sourceUrl).toBe("https://bookhive.buzz/books/bk_1");
  });

  it("preserves manual books by default and clears them when requested", () => {
    const existing: Book[] = [
      book({ id: "manual-1", source: "unknown", manual: true, title: "Manual A" }),
      book({ id: "gr-1", source: "goodreads", title: "Old" }),
    ];
    const imported: Book[] = [book({ id: "gr-2", source: "goodreads", title: "New" })];

    const kept = mergeImportForSource(existing, imported, "goodreads");
    expect(kept.map((b) => b.id).sort()).toEqual(["gr-2", "manual-1"]);

    const cleared = mergeImportForSource(existing, imported, "goodreads", { clearManual: true });
    expect(cleared.map((b) => b.id)).toEqual(["gr-2"]);
  });

  it("re-importing Bookhive replaces only Bookhive entries", () => {
    const existing: Book[] = [
      book({ id: "bh-1", source: "bookhive", title: "Stale Bookhive" }),
      book({ id: "gr-1", source: "goodreads", title: "Goodreads Kept" }),
      book({ id: "sg-1", source: "storygraph", title: "StoryGraph Kept" }),
    ];
    const imported: Book[] = [book({ id: "bh-2", source: "bookhive", title: "Fresh Bookhive" })];

    const result = mergeImportForSource(existing, imported, "bookhive");

    expect(result.map((b) => b.id).sort()).toEqual(["bh-2", "gr-1", "sg-1"]);
  });

  it("preserves manual flag when a manual book matches an imported one", () => {
    const existing: Book[] = [
      book({
        id: "manual-1",
        source: "unknown",
        manual: true,
        title: "Foundation",
        author: "Asimov",
      }),
    ];
    const imported: Book[] = [
      book({ id: "gr-1", source: "goodreads", title: "Foundation", author: "Asimov" }),
    ];

    const result = mergeImportForSource(existing, imported, "goodreads");

    expect(result).toHaveLength(1);
    // Goodreads has higher non-bookhive priority than unknown (manual), so
    // the goodreads record wins on id, but manual=true is preserved through
    // the merge so the user-added book doesn't get wiped on the next import.
    expect(result[0].id).toBe("gr-1");
    expect(result[0].manual).toBe(true);
  });
});
