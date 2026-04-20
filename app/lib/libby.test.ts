import { describe, it, expect } from "vitest";
import { contentWordsMatch } from "./libby";

describe("contentWordsMatch", () => {
  it("rejects sibling-series titles that only share the series word", () => {
    // The bug we're fixing: "Children of Time" was matching "Children of Ruin"
    // because the old "at least half" rule passed on a single shared word.
    expect(contentWordsMatch("Children of Time", "Children of Ruin")).toBe(false);
    expect(contentWordsMatch("Children of Time", "Children of Strife")).toBe(false);
  });

  it("accepts the exact same title", () => {
    expect(contentWordsMatch("Children of Time", "Children of Time")).toBe(true);
  });

  it("accepts a title with extra words around the search words", () => {
    expect(contentWordsMatch("Children of Time", "Children of Time: A Novel")).toBe(true);
    expect(
      contentWordsMatch("Children of Time", "Children of Time (Children of Time series, book 1)"),
    ).toBe(true);
  });

  it("ignores stop words like 'of', 'the', 'and'", () => {
    // "the" is a stop word; only "great" and "gatsby" need to match.
    expect(contentWordsMatch("The Great Gatsby", "Great Gatsby")).toBe(true);
  });

  it("normalizes punctuation and case", () => {
    // Periods, commas, and case differences should not block a match.
    expect(contentWordsMatch("Foundation, Vol. 1", "foundation vol 1")).toBe(true);
    expect(contentWordsMatch("DUNE", "dune")).toBe(true);
  });

  it("returns true when the search has no content words", () => {
    expect(contentWordsMatch("the of and", "anything")).toBe(true);
  });

  it("rejects when even one content word is missing from the result", () => {
    expect(contentWordsMatch("The Two Towers", "Towers of Midnight")).toBe(false);
  });
});
