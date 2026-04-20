import { describe, it, expect } from "vitest";
import { bookKey, dedupeBooks, mergeBooks } from "./dedupe";
import type { Book } from "./storage";

function book(overrides: Partial<Book> = {}): Book {
  return {
    id: "b1",
    title: "Foundation",
    author: "Isaac Asimov",
    source: "unknown",
    ...overrides,
  };
}

describe("bookKey", () => {
  it("uses workId when present", () => {
    expect(bookKey(book({ workId: "OL1W" }))).toBe("work:OL1W");
  });

  it("falls back to normalized title+author when workId is missing", () => {
    expect(bookKey(book({ title: "F. Scott's Gatsby!", author: "Fitzgerald" }))).toBe(
      "fuzzy:fscottsgatsby\0fitzgerald",
    );
  });

  it("normalizes punctuation and case so variants collapse", () => {
    const a = bookKey(book({ title: "The Great Gatsby", author: "F. Scott Fitzgerald" }));
    const b = bookKey(book({ title: "the  great  gatsby", author: "F Scott Fitzgerald" }));
    expect(a).toBe(b);
  });
});

describe("mergeBooks", () => {
  it("keeps primary's id but fills missing fields from secondary", () => {
    const primary = book({ id: "p", isbn13: undefined, imageUrl: undefined });
    const secondary = book({
      id: "s",
      isbn13: "9780553293357",
      imageUrl: "https://example.com/cover.jpg",
    });
    const merged = mergeBooks(primary, secondary);
    expect(merged.id).toBe("p");
    expect(merged.isbn13).toBe("9780553293357");
    expect(merged.imageUrl).toBe("https://example.com/cover.jpg");
  });

  it("does not overwrite primary's populated fields", () => {
    const primary = book({ isbn13: "1111111111111" });
    const secondary = book({ isbn13: "2222222222222" });
    expect(mergeBooks(primary, secondary).isbn13).toBe("1111111111111");
  });

  it("propagates manual=true if either side was manual", () => {
    const primary = book({ manual: undefined });
    const secondary = book({ manual: true });
    expect(mergeBooks(primary, secondary).manual).toBe(true);
  });
});

describe("dedupeBooks", () => {
  it("collapses duplicates sharing a workId", () => {
    const result = dedupeBooks([
      book({ id: "a", workId: "OL1W", source: "goodreads" }),
      book({ id: "b", workId: "OL1W", source: "hardcover", isbn13: "9780441013593" }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
    expect(result[0].isbn13).toBe("9780441013593");
  });

  it("collapses duplicates sharing a fuzzy title+author when workId is absent", () => {
    const result = dedupeBooks([
      book({ id: "a", title: "Dune", author: "Frank Herbert" }),
      book({ id: "b", title: "dune", author: "frank herbert" }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
  });

  it("keeps separate entries for different workIds", () => {
    const result = dedupeBooks([
      book({ id: "a", workId: "OL1W" }),
      book({ id: "b", workId: "OL2W" }),
    ]);
    expect(result).toHaveLength(2);
  });

  it("keeps separate entries for different titles without workId", () => {
    const result = dedupeBooks([
      book({ id: "a", title: "Dune" }),
      book({ id: "b", title: "Foundation" }),
    ]);
    expect(result).toHaveLength(2);
  });

  it("preserves order of first occurrence", () => {
    const result = dedupeBooks([
      book({ id: "a", title: "Dune" }),
      book({ id: "b", title: "Foundation" }),
      book({ id: "c", title: "dune" }),
    ]);
    expect(result.map((b) => b.id)).toEqual(["a", "b"]);
  });
});
