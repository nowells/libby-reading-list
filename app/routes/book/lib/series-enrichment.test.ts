import { describe, it, expect } from "vitest";
import type { LibbyMediaItem } from "~/lib/libby";
import type { SeriesBook } from "~/lib/openlibrary";
import {
  buildLibbyTitleIndex,
  summarizeAvailability,
  mergeSeriesWithLibby,
  sortByReadingOrder,
  extractLibbySeriesBooks,
  libbyCandidateToSeriesBook,
  mergeLibbyAndOlSeries,
  seriesNameMatches,
} from "./series-enrichment";

function libbyItem(overrides: Partial<LibbyMediaItem>): LibbyMediaItem {
  return {
    id: "id",
    title: "Title",
    sortTitle: "title",
    type: { id: "ebook", name: "eBook" },
    formats: [],
    creators: [],
    ...overrides,
  };
}

function olBook(overrides: Partial<SeriesBook>): SeriesBook {
  return {
    workId: "OL1W",
    title: "Title",
    ...overrides,
  };
}

describe("buildLibbyTitleIndex", () => {
  it("groups items across libraries by normalized sort title", () => {
    const idx = buildLibbyTitleIndex([
      {
        libraryKey: "lib1",
        items: [
          libbyItem({ id: "a", sortTitle: "All Systems Red" }),
          libbyItem({ id: "b", sortTitle: "Artificial Condition" }),
        ],
      },
      {
        libraryKey: "lib2",
        items: [libbyItem({ id: "c", sortTitle: "all systems red" })],
      },
    ]);
    expect(idx.get("all systems red")).toHaveLength(2);
    expect(idx.get("artificial condition")).toHaveLength(1);
  });

  it("falls back to title when sortTitle is empty", () => {
    const idx = buildLibbyTitleIndex([
      {
        libraryKey: "lib1",
        items: [libbyItem({ id: "a", sortTitle: "", title: "Network Effect" })],
      },
    ]);
    expect(idx.get("network effect")).toHaveLength(1);
  });
});

describe("summarizeAvailability", () => {
  it("returns inLibrary=false on no matches", () => {
    expect(summarizeAvailability([], "any")).toEqual({
      isAvailable: false,
      formats: [],
      inLibrary: false,
    });
  });

  it("aggregates formats and picks readingOrder from matching series", () => {
    const out = summarizeAvailability(
      [
        {
          libraryKey: "lib1",
          item: libbyItem({
            id: "a",
            type: { id: "ebook", name: "eBook" },
            detailedSeries: { seriesName: "Murderbot", readingOrder: "2" },
            isAvailable: false,
            estimatedWaitDays: 10,
          }),
        },
        {
          libraryKey: "lib1",
          item: libbyItem({
            id: "b",
            type: { id: "audiobook", name: "Audiobook" },
            detailedSeries: { seriesName: "Murderbot", readingOrder: "2" },
            isAvailable: false,
            estimatedWaitDays: 3,
          }),
        },
      ],
      "murderbot",
    );
    expect(out.inLibrary).toBe(true);
    expect(out.isAvailable).toBe(false);
    expect(out.estimatedWaitDays).toBe(3);
    expect(out.formats.sort()).toEqual(["audiobook", "ebook"]);
    expect(out.readingOrder).toBe("2");
  });

  it("prefers an available copy and reports zero wait", () => {
    const out = summarizeAvailability(
      [
        {
          libraryKey: "lib1",
          item: libbyItem({ id: "a", isAvailable: false, estimatedWaitDays: 30 }),
        },
        { libraryKey: "lib2", item: libbyItem({ id: "b", isAvailable: true }) },
      ],
      "anything",
    );
    expect(out.isAvailable).toBe(true);
    expect(out.estimatedWaitDays).toBe(0);
    expect(out.bestLibraryKey).toBe("lib2");
    expect(out.bestMediaId).toBe("b");
  });

  it("ignores readingOrder from a different series", () => {
    const out = summarizeAvailability(
      [
        {
          libraryKey: "lib1",
          item: libbyItem({
            id: "a",
            detailedSeries: { seriesName: "Other Series", readingOrder: "99" },
            isAvailable: true,
          }),
        },
      ],
      "murderbot",
    );
    expect(out.readingOrder).toBeUndefined();
  });
});

describe("mergeSeriesWithLibby", () => {
  it("attaches availability and reading order to OL books that match Libby titles", () => {
    const merged = mergeSeriesWithLibby(
      [
        olBook({ workId: "OL1W", title: "All Systems Red", firstPublishYear: 2017 }),
        olBook({ workId: "OL2W", title: "Artificial Condition", firstPublishYear: 2018 }),
        olBook({ workId: "OL3W", title: "Mystery Spinoff", firstPublishYear: 2025 }),
      ],
      [
        {
          libraryKey: "lib1",
          items: [
            libbyItem({
              id: "a",
              sortTitle: "all systems red",
              detailedSeries: { seriesName: "Murderbot", readingOrder: "1" },
              isAvailable: true,
            }),
            libbyItem({
              id: "b",
              sortTitle: "artificial condition",
              detailedSeries: { seriesName: "Murderbot", readingOrder: "2" },
              isAvailable: false,
              estimatedWaitDays: 5,
            }),
          ],
        },
      ],
      "Murderbot",
    );
    const byId = Object.fromEntries(merged.map((b) => [b.workId, b]));
    expect(byId["OL1W"].readingOrder).toBe("1");
    expect(byId["OL1W"].availability?.isAvailable).toBe(true);
    expect(byId["OL2W"].readingOrder).toBe("2");
    expect(byId["OL2W"].availability?.isAvailable).toBe(false);
    expect(byId["OL3W"].availability?.inLibrary).toBe(false);
  });
});

describe("sortByReadingOrder", () => {
  it("orders by reading order, ties broken by year", () => {
    const sorted = sortByReadingOrder([
      { workId: "a", title: "A", readingOrder: "3" },
      { workId: "b", title: "B", readingOrder: "1" },
      { workId: "c", title: "C", readingOrder: "2.5" },
      { workId: "d", title: "D" },
      { workId: "e", title: "E", firstPublishYear: 2010 },
      { workId: "f", title: "F", firstPublishYear: 2005 },
    ]);
    // numbered first, in numeric order
    expect(sorted.slice(0, 3).map((b) => b.workId)).toEqual(["b", "c", "a"]);
    // unnumbered fall to end, ordered by year
    expect(sorted.slice(3).map((b) => b.workId)).toEqual(["f", "e", "d"]);
  });
});

describe("seriesNameMatches", () => {
  it("matches case-insensitively when names are identical", () => {
    expect(seriesNameMatches("Murderbot Diaries", "MURDERBOT DIARIES")).toBe(true);
  });

  it("accepts substring drift in either direction", () => {
    expect(seriesNameMatches("Murderbot Diaries", "Murderbot")).toBe(true);
    expect(seriesNameMatches("Discworld", "Discworld Series")).toBe(true);
  });

  it("rejects unrelated names", () => {
    expect(seriesNameMatches("Discworld", "Foundation")).toBe(false);
  });

  it("rejects empty input", () => {
    expect(seriesNameMatches("", "anything")).toBe(false);
  });
});

describe("extractLibbySeriesBooks", () => {
  it("filters to items whose detailedSeries matches and groups by title", () => {
    const candidates = extractLibbySeriesBooks(
      [
        {
          libraryKey: "lib1",
          items: [
            // Two formats of the same Penny book
            libbyItem({
              id: "a",
              title: "Still Life",
              sortTitle: "still life",
              type: { id: "ebook", name: "eBook" },
              creators: [{ name: "Louise Penny", role: "Author" }],
              detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "1" },
              isAvailable: true,
              publishDate: "2005-09-01",
              covers: { cover150Wide: { href: "https://example/still.jpg" } },
            }),
            libbyItem({
              id: "b",
              title: "Still Life",
              sortTitle: "still life",
              type: { id: "audiobook", name: "Audiobook" },
              creators: [{ name: "Louise Penny", role: "Author" }],
              detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "1" },
              isAvailable: false,
              estimatedWaitDays: 14,
            }),
            // Different Penny book, same series
            libbyItem({
              id: "c",
              title: "Kingdom of the Blind",
              sortTitle: "kingdom of the blind",
              creators: [{ name: "Louise Penny", role: "Author" }],
              detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "14" },
            }),
            // A book in a *different* series should be ignored
            libbyItem({
              id: "d",
              title: "Unrelated",
              sortTitle: "unrelated",
              detailedSeries: { seriesName: "Some Other Series", readingOrder: "1" },
            }),
            // No series at all — ignored
            libbyItem({ id: "e", title: "Just a Book", sortTitle: "just a book" }),
          ],
        },
      ],
      "Chief Inspector Armand Gamache",
    );
    expect(candidates).toHaveLength(2);
    const stillLife = candidates.find((c) => c.title === "Still Life");
    expect(stillLife).toBeDefined();
    expect(stillLife!.matches).toHaveLength(2);
    expect(stillLife!.author).toBe("Louise Penny");
    expect(stillLife!.readingOrder).toBe("1");
    expect(stillLife!.firstPublishYear).toBe(2005);
    expect(stillLife!.coverUrl).toBe("https://example/still.jpg");
    const kotb = candidates.find((c) => c.title === "Kingdom of the Blind");
    expect(kotb!.readingOrder).toBe("14");
  });

  it("accepts series-name drift via fuzzy match", () => {
    const candidates = extractLibbySeriesBooks(
      [
        {
          libraryKey: "lib1",
          items: [
            libbyItem({
              id: "a",
              title: "Discworld 1",
              sortTitle: "discworld 1",
              detailedSeries: { seriesName: "Discworld Series", readingOrder: "1" },
            }),
          ],
        },
      ],
      "Discworld",
    );
    expect(candidates).toHaveLength(1);
  });

  it("collapses editions whose sortTitle drifts but readingOrder agrees", () => {
    // The actual production bug: Libby returns multiple editions of "Still
    // Life" with slightly different sortTitles ("still life", "still life
    // unabridged", "still life a chief inspector gamache novel"). These
    // would have rendered as three separate cards under the old title-only
    // dedup; readingOrder collapses them into one.
    const candidates = extractLibbySeriesBooks(
      [
        {
          libraryKey: "lib1",
          items: [
            libbyItem({
              id: "a",
              title: "Still Life",
              sortTitle: "still life",
              creators: [{ name: "Louise Penny", role: "Author" }],
              detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "1" },
            }),
            libbyItem({
              id: "b",
              title: "Still Life: Unabridged",
              sortTitle: "still life unabridged",
              creators: [{ name: "Louise Penny", role: "Author" }],
              detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "1" },
            }),
            libbyItem({
              id: "c",
              title: "Still Life: A Chief Inspector Gamache Novel",
              sortTitle: "still life a chief inspector gamache novel",
              creators: [{ name: "Louise Penny", role: "Author" }],
              detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "1" },
            }),
          ],
        },
      ],
      "Chief Inspector Armand Gamache",
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].matches).toHaveLength(3);
    // Should pick the shortest title across editions for display.
    expect(candidates[0].title).toBe("Still Life");
  });

  it("collapses editions when readingOrder is missing AND sortTitle drifts", () => {
    // The combo that broke The Beautiful Mystery: Libby returns one
    // edition with `readingOrder: "8"` and a clean sortTitle, plus
    // another edition with no readingOrder *and* a sortTitle that
    // baked the subtitle in. Index-under-both-keys alone wasn't
    // enough — the title key for the longer-sortTitle edition didn't
    // match either of the cleaner edition's keys. Reducing the title
    // key to the "core" title (everything before the first ":" /
    // parens) makes them collide.
    const candidates = extractLibbySeriesBooks(
      [
        {
          libraryKey: "lib1",
          items: [
            libbyItem({
              id: "a",
              title: "The Beautiful Mystery",
              sortTitle: "beautiful mystery",
              creators: [{ name: "Louise Penny", role: "Author" }],
              detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "8" },
            }),
            libbyItem({
              id: "b",
              title: "The Beautiful Mystery: A Chief Inspector Gamache Novel",
              sortTitle: "beautiful mystery a chief inspector gamache novel",
              creators: [{ name: "Louise Penny", role: "Author" }],
              detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "" },
            }),
          ],
        },
      ],
      "Chief Inspector Armand Gamache",
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].matches).toHaveLength(2);
    expect(candidates[0].readingOrder).toBe("8");
  });

  it("collapses editions even when only some have readingOrder set", () => {
    // Real-world bug: Libby returns multiple editions of "Still Life"
    // where some carry detailedSeries.readingOrder = "1" and others
    // come back without a readingOrder at all (just seriesName). With
    // a single-key dedup, the order-keyed edition and the title-keyed
    // edition land in different buckets and we end up rendering the
    // book twice. Indexing under both keys collapses them.
    const candidates = extractLibbySeriesBooks(
      [
        {
          libraryKey: "lib1",
          items: [
            libbyItem({
              id: "a",
              title: "Still Life",
              sortTitle: "still life",
              creators: [{ name: "Louise Penny", role: "Author" }],
              detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "1" },
            }),
            libbyItem({
              id: "b",
              title: "Still Life",
              sortTitle: "still life",
              creators: [{ name: "Louise Penny", role: "Author" }],
              // Same book, but readingOrder is empty on this edition.
              detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "" },
            }),
            libbyItem({
              id: "c",
              title: "Still Life: A Chief Inspector Gamache Novel",
              sortTitle: "still life a chief inspector gamache novel",
              creators: [{ name: "Louise Penny", role: "Author" }],
              // Different sortTitle, but readingOrder agrees with item a.
              detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "1" },
            }),
          ],
        },
      ],
      "Chief Inspector Armand Gamache",
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].matches).toHaveLength(3);
  });

  it("falls back to title-keyed dedup when readingOrder is missing", () => {
    const candidates = extractLibbySeriesBooks(
      [
        {
          libraryKey: "lib1",
          items: [
            libbyItem({
              id: "a",
              title: "Spinoff",
              sortTitle: "spinoff",
              detailedSeries: { seriesName: "Discworld", readingOrder: "" },
            }),
            libbyItem({
              id: "b",
              title: "Spinoff",
              sortTitle: "spinoff",
              detailedSeries: { seriesName: "Discworld", readingOrder: "" },
            }),
          ],
        },
      ],
      "Discworld",
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].matches).toHaveLength(2);
  });
});

describe("libbyCandidateToSeriesBook", () => {
  it("preserves Libby fields and runs the availability summary", () => {
    const out = libbyCandidateToSeriesBook(
      {
        title: "Still Life",
        author: "Louise Penny",
        readingOrder: "1",
        coverUrl: "https://example/cover.jpg",
        firstPublishYear: 2005,
        matches: [
          {
            libraryKey: "lib1",
            item: libbyItem({
              id: "a",
              type: { id: "ebook", name: "eBook" },
              isAvailable: true,
              detailedSeries: { seriesName: "Chief Inspector Armand Gamache", readingOrder: "1" },
            }),
          },
        ],
      },
      "Chief Inspector Armand Gamache",
      "OL_STILL_W",
    );
    expect(out.workId).toBe("OL_STILL_W");
    expect(out.title).toBe("Still Life");
    expect(out.authorName).toBe("Louise Penny");
    expect(out.readingOrder).toBe("1");
    expect(out.coverUrl).toBe("https://example/cover.jpg");
    expect(out.firstPublishYear).toBe(2005);
    expect(out.availability?.isAvailable).toBe(true);
    expect(out.availability?.formats).toEqual(["ebook"]);
  });

  it("defaults workId to empty when none was resolved", () => {
    const out = libbyCandidateToSeriesBook({ title: "X", author: "Y", matches: [] }, "S");
    expect(out.workId).toBe("");
  });
});

describe("mergeLibbyAndOlSeries", () => {
  it("uses Libby as primary, fills missing workIds and coverIds from OL", () => {
    const libby = [
      libbyCandidateToSeriesBook(
        {
          title: "Still Life",
          author: "Louise Penny",
          readingOrder: "1",
          coverUrl: "https://libby/cover.jpg",
          matches: [],
        },
        "Gamache",
        "", // workId missing — OL should fill it
      ),
    ];
    const ol: SeriesBook[] = [
      olBook({
        workId: "OL_STILL_W",
        title: "Still Life",
        firstPublishYear: 2005,
        coverId: 12345,
      }),
    ];
    const merged = mergeLibbyAndOlSeries(libby, ol);
    expect(merged).toHaveLength(1);
    expect(merged[0].workId).toBe("OL_STILL_W");
    expect(merged[0].coverId).toBe(12345);
    expect(merged[0].coverUrl).toBe("https://libby/cover.jpg");
    expect(merged[0].readingOrder).toBe("1");
  });

  it("appends OL-only books that Libby didn't surface", () => {
    const libby = [libbyCandidateToSeriesBook({ title: "Still Life", matches: [] }, "Gamache", "")];
    const ol: SeriesBook[] = [olBook({ workId: "OL_RARE_W", title: "Out of Print Spinoff" })];
    const merged = mergeLibbyAndOlSeries(libby, ol);
    expect(merged).toHaveLength(2);
    expect(merged[1].title).toBe("Out of Print Spinoff");
    expect(merged[1].availability?.inLibrary).toBe(false);
  });

  it("merges Libby + OL by readingOrder when titles disagree", () => {
    // OL stores "Still Life" while Libby has the longer title with subtitle.
    // The reading-order match keeps them as a single row.
    const libby = [
      libbyCandidateToSeriesBook(
        {
          title: "Still Life: A Chief Inspector Gamache Novel",
          author: "Louise Penny",
          readingOrder: "1",
          matches: [],
        },
        "Gamache",
        "",
      ),
    ];
    const ol: SeriesBook[] = [
      olBook({
        workId: "OL_STILL_W",
        title: "Still Life",
        readingOrder: "1",
        firstPublishYear: 2005,
      }),
    ];
    const merged = mergeLibbyAndOlSeries(libby, ol);
    expect(merged).toHaveLength(1);
    expect(merged[0].workId).toBe("OL_STILL_W");
    expect(merged[0].firstPublishYear).toBe(2005);
  });
});
