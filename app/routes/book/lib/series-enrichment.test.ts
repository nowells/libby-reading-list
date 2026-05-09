import { describe, it, expect } from "vitest";
import type { LibbyMediaItem } from "~/lib/libby";
import type { SeriesBook } from "~/lib/openlibrary";
import {
  buildLibbyTitleIndex,
  summarizeAvailability,
  mergeSeriesWithLibby,
  sortByReadingOrder,
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
