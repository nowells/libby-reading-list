import { describe, it, expect, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { worker } from "~/test/setup";
import {
  isbn10to13,
  parseEdition,
  parseWorkEditions,
  enrichBooksWithWorkId,
  getWorkEditionIsbns,
  getWorkMetadata,
} from "./openlibrary";
import type { Book } from "./storage";

// ---------------------------------------------------------------------------
// parseEdition (existing tests)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// isbn10to13 (existing tests)
// ---------------------------------------------------------------------------
describe("isbn10to13", () => {
  it("converts a well-known ISBN-10 to its canonical ISBN-13", () => {
    expect(isbn10to13("0345391802")).toBe("9780345391803");
  });

  it("handles trailing X check digit", () => {
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

// ---------------------------------------------------------------------------
// parseWorkEditions (existing tests)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// getWorkMetadata
// ---------------------------------------------------------------------------
describe("getWorkMetadata", () => {
  it("fetches subjects and first publish year", async () => {
    const meta = await getWorkMetadata("OL17823492W");
    expect(meta).not.toBeNull();
    expect(meta!.subjects).toContain("Science Fiction");
    expect(meta!.firstPublishYear).toBe(2015);
  });

  it("returns null for invalid workId format", async () => {
    const meta = await getWorkMetadata("invalid");
    expect(meta).toBeNull();
  });

  it("returns null on API error", async () => {
    worker.use(
      http.get("https://openlibrary.org/works/:workId.json", () => {
        return new HttpResponse(null, { status: 500 });
      }),
    );
    const meta = await getWorkMetadata("OL999W");
    expect(meta).toBeNull();
  });

  it("caches results in localStorage", async () => {
    await getWorkMetadata("OL17823492W");
    const cached = localStorage.getItem("shelfcheck:ol-work-meta:OL17823492W");
    expect(cached).not.toBeNull();
    const entry = JSON.parse(cached!);
    expect(entry.v.subjects).toContain("Science Fiction");
    expect(entry.t).toBeGreaterThan(Date.now());
  });

  it("uses cached results when available", async () => {
    // Pre-populate cache
    const entry = {
      v: { subjects: ["Cached Genre"], firstPublishYear: 2000 },
      t: Date.now() + 1000 * 60 * 60 * 24,
    };
    localStorage.setItem("shelfcheck:ol-work-meta:OL999W", JSON.stringify(entry));

    const meta = await getWorkMetadata("OL999W");
    expect(meta!.subjects).toEqual(["Cached Genre"]);
    expect(meta!.firstPublishYear).toBe(2000);
  });

  it("ignores expired cache", async () => {
    const entry = {
      v: { subjects: ["Old"], firstPublishYear: 1900 },
      t: Date.now() - 1000, // expired
    };
    localStorage.setItem("shelfcheck:ol-work-meta:OL17823492W", JSON.stringify(entry));

    const meta = await getWorkMetadata("OL17823492W");
    expect(meta!.subjects).toContain("Science Fiction");
    expect(meta!.firstPublishYear).toBe(2015);
  });

  it("handles missing first_publish_date", async () => {
    worker.use(
      http.get("https://openlibrary.org/works/:workId.json", () => {
        return HttpResponse.json({ subjects: ["Fiction"] });
      }),
    );
    const meta = await getWorkMetadata("OL999W");
    expect(meta!.subjects).toEqual(["Fiction"]);
    expect(meta!.firstPublishYear).toBeUndefined();
  });

  it("limits subjects to 20", async () => {
    const subjects = Array.from({ length: 30 }, (_, i) => `Subject ${i}`);
    worker.use(
      http.get("https://openlibrary.org/works/:workId.json", () => {
        return HttpResponse.json({ subjects });
      }),
    );
    const meta = await getWorkMetadata("OL999W");
    expect(meta!.subjects).toHaveLength(20);
  });
});

// ---------------------------------------------------------------------------
// getWorkEditionIsbns
// ---------------------------------------------------------------------------
describe("getWorkEditionIsbns", () => {
  it("fetches and parses ISBNs for a work", async () => {
    const isbns = await getWorkEditionIsbns("OL17823492W");
    expect(isbns).toContain("9780316452502");
    expect(isbns).toContain("9781509836246");
  });

  it("returns empty array for invalid workId", async () => {
    const isbns = await getWorkEditionIsbns("invalid");
    expect(isbns).toEqual([]);
  });

  it("returns empty array on API error", async () => {
    worker.use(
      http.get("https://openlibrary.org/works/:workId/editions.json", () => {
        return new HttpResponse(null, { status: 500 });
      }),
    );
    const isbns = await getWorkEditionIsbns("OL999W");
    expect(isbns).toEqual([]);
  });

  it("caches results in localStorage", async () => {
    await getWorkEditionIsbns("OL17823492W");
    const cached = localStorage.getItem("shelfcheck:ol-work-editions:OL17823492W");
    expect(cached).not.toBeNull();
    const entry = JSON.parse(cached!);
    expect(entry.v).toContain("9780316452502");
  });

  it("uses cached results when available", async () => {
    const entry = {
      v: ["9781234567890"],
      t: Date.now() + 1000 * 60 * 60 * 24,
    };
    localStorage.setItem("shelfcheck:ol-work-editions:OL999W", JSON.stringify(entry));

    const isbns = await getWorkEditionIsbns("OL999W");
    expect(isbns).toEqual(["9781234567890"]);
  });
});

// ---------------------------------------------------------------------------
// enrichBooksWithWorkId
// ---------------------------------------------------------------------------
describe("enrichBooksWithWorkId", () => {
  function makeBook(overrides: Partial<Book> = {}): Book {
    return {
      id: "b1",
      title: "Children of Time",
      author: "Adrian Tchaikovsky",
      isbn13: "9780316452502",
      source: "goodreads",
      ...overrides,
    };
  }

  it("enriches a book with ISBN via OpenLibrary", async () => {
    const books = [makeBook()];
    const result = await enrichBooksWithWorkId(books);
    expect(result[0].workId).toBe("OL17823492W");
    expect(result[0].canonicalTitle).toBe("Children of Time");
  });

  it("skips books that already have a workId", async () => {
    const books = [makeBook({ workId: "OL_EXISTING" })];
    const result = await enrichBooksWithWorkId(books);
    expect(result[0].workId).toBe("OL_EXISTING");
  });

  it("fires onProgress callback", async () => {
    const progress: Array<[number, number]> = [];
    const books = [makeBook()];
    await enrichBooksWithWorkId(books, {
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(progress[0]).toEqual([0, 1]); // initial
    expect(progress[progress.length - 1][0]).toBe(1); // completed
  });

  it("returns books unchanged when all already have workIds", async () => {
    const books = [makeBook({ workId: "OL1W" }), makeBook({ id: "b2", workId: "OL2W" })];
    const result = await enrichBooksWithWorkId(books);
    expect(result).toEqual(books);
  });

  it("falls back to title+author search when no ISBN", async () => {
    const books = [makeBook({ isbn13: undefined })];
    const result = await enrichBooksWithWorkId(books);
    expect(result[0].workId).toBe("OL17823492W");
  });

  it("enriches with subjects and firstPublishYear from work metadata", async () => {
    const books = [makeBook()];
    const result = await enrichBooksWithWorkId(books);
    expect(result[0].subjects).toContain("Science Fiction");
    expect(result[0].firstPublishYear).toBe(2015);
  });

  it("preserves existing subjects and firstPublishYear", async () => {
    const books = [
      makeBook({
        subjects: ["My Custom Genre"],
        firstPublishYear: 1999,
      }),
    ];
    const result = await enrichBooksWithWorkId(books);
    expect(result[0].subjects).toEqual(["My Custom Genre"]);
    expect(result[0].firstPublishYear).toBe(1999);
  });

  it("handles API errors gracefully — returns book unchanged", async () => {
    worker.use(
      http.get("https://openlibrary.org/isbn/:isbn.json", () => {
        return new HttpResponse(null, { status: 500 });
      }),
      http.get("https://openlibrary.org/search.json", () => {
        return new HttpResponse(null, { status: 500 });
      }),
    );
    const books = [makeBook({ isbn13: "9789999999999" })];
    const result = await enrichBooksWithWorkId(books);
    expect(result[0].workId).toBeUndefined();
    expect(result[0].title).toBe("Children of Time");
  });

  it("handles 404 for ISBN lookup — falls back to search", async () => {
    worker.use(
      http.get("https://openlibrary.org/isbn/:isbn.json", () => {
        return new HttpResponse(null, { status: 404 });
      }),
    );
    // Search should still find it
    const books = [makeBook()];
    const result = await enrichBooksWithWorkId(books);
    expect(result[0].workId).toBe("OL17823492W");
  });

  it("respects concurrency option", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    worker.use(
      http.get("https://openlibrary.org/isbn/:isbn.json", async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 10));
        concurrent--;
        return HttpResponse.json({
          title: "Book",
          works: [{ key: "/works/OL1W" }],
        });
      }),
      http.get("https://openlibrary.org/works/:workId.json", () => {
        return HttpResponse.json({ subjects: [] });
      }),
    );
    const books = Array.from({ length: 10 }, (_, i) =>
      makeBook({ id: `b${i}`, isbn13: `978000000000${i}` }),
    );
    await enrichBooksWithWorkId(books, { concurrency: 2 });
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("skips books with no ISBN and no title", async () => {
    const books = [makeBook({ isbn13: undefined, title: "", author: "" })];
    const result = await enrichBooksWithWorkId(books);
    expect(result[0].workId).toBeUndefined();
  });
});
