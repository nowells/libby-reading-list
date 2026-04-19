import { describe, it, expect } from "vitest";
import { isbn10to13, parseEdition, parseWorkEditions } from "./openlibrary";

describe("parseEdition", () => {
  it("extracts workId from an edition with a /works/ key", () => {
    const result = parseEdition({
      title: "Children of Time",
      works: [{ key: "/works/OL17823492W" }],
    });
    expect(result).toEqual({
      workId: "OL17823492W",
      canonicalTitle: "Children of Time",
    });
  });

  it("trims whitespace from canonical title", () => {
    const result = parseEdition({
      title: "  Dune  ",
      works: [{ key: "/works/OL45883W" }],
    });
    expect(result?.canonicalTitle).toBe("Dune");
  });

  it("returns null when works is missing", () => {
    expect(parseEdition({ title: "Something" })).toBeNull();
  });

  it("returns null when works key has an unexpected shape", () => {
    expect(parseEdition({ works: [{ key: "/not-a-work/abc" }] })).toBeNull();
    expect(parseEdition({ works: [{ key: "OL123W" }] })).toBeNull();
    expect(parseEdition({ works: [{}] })).toBeNull();
    expect(parseEdition({ works: [] })).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(parseEdition(null)).toBeNull();
    expect(parseEdition(undefined)).toBeNull();
    expect(parseEdition("string")).toBeNull();
  });

  it("omits canonicalTitle when title is missing or empty", () => {
    const result = parseEdition({ works: [{ key: "/works/OL1W" }] });
    expect(result?.canonicalTitle).toBeUndefined();
    const empty = parseEdition({ title: "   ", works: [{ key: "/works/OL1W" }] });
    expect(empty?.canonicalTitle).toBeUndefined();
  });
});

describe("isbn10to13", () => {
  it("converts a well-known ISBN-10 to its canonical ISBN-13", () => {
    // 'The Hitchhiker's Guide to the Galaxy' paperback
    expect(isbn10to13("0345391802")).toBe("9780345391803");
  });

  it("handles trailing X check digit", () => {
    // Real ISBN-10 with X checksum ('The Selfish Gene' hardcover).
    expect(isbn10to13("019286092X")).toBe("9780192860927");
  });

  it("strips hyphens before converting", () => {
    expect(isbn10to13("0-345-39180-2")).toBe("9780345391803");
  });

  it("returns null for invalid lengths", () => {
    expect(isbn10to13("12345")).toBeNull();
    expect(isbn10to13("")).toBeNull();
  });
});

describe("parseWorkEditions", () => {
  it("collects ISBN-13s across editions preserving first-seen order", () => {
    const out = parseWorkEditions({
      entries: [
        { isbn_13: ["9781111111111"], isbn_10: [] },
        { isbn_13: ["9782222222222", "9781111111111"] },
        { isbn_13: ["9783333333333"] },
      ],
    });
    expect(out).toEqual(["9781111111111", "9782222222222", "9783333333333"]);
  });

  it("converts ISBN-10s to ISBN-13 and dedupes against existing 13s", () => {
    const out = parseWorkEditions({
      entries: [
        { isbn_13: ["9780345391803"] },
        // This ISBN-10 is the 10-digit form of 9780345391803 — should be deduped.
        { isbn_10: ["0345391802"] },
        { isbn_10: ["019286092X"] },
      ],
    });
    expect(out).toEqual(["9780345391803", "9780192860927"]);
  });

  it("ignores non-string ISBN entries and malformed input", () => {
    expect(parseWorkEditions(null)).toEqual([]);
    expect(parseWorkEditions({})).toEqual([]);
    expect(parseWorkEditions({ entries: "nope" })).toEqual([]);
    expect(parseWorkEditions({ entries: [{ isbn_13: [null, 123, "9781111111111"] }] })).toEqual([
      "9781111111111",
    ]);
  });

  it("strips formatting from raw ISBN strings", () => {
    const out = parseWorkEditions({
      entries: [{ isbn_13: ["978-1-111-11111-1"] }],
    });
    expect(out).toEqual(["9781111111111"]);
  });
});
