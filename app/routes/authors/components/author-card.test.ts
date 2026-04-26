import { describe, it, expect } from "vitest";
import { categorizeWork, bestAuthorCategory, CATEGORY_ORDER } from "./author-card";
import type { AuthorBookResult, LibbyFormatResult } from "../hooks/use-author-availability";

function makeLibbyResult(overrides: Partial<LibbyFormatResult> = {}): LibbyFormatResult {
  return {
    mediaItem: {
      id: "media-1",
      title: "Test Book",
      sortTitle: "test book",
      type: { id: "ebook", name: "eBook" },
      formats: [{ id: "ebook-overdrive", name: "OverDrive Read" }],
      creators: [{ name: "Author", role: "Author" }],
      publisher: { id: "pub-1", name: "Publisher" },
      publishDate: "2020-01-01",
      isAvailable: true,
      ownedCopies: 5,
      availableCopies: 2,
      holdsCount: 0,
    },
    availability: {
      id: "media-1",
      copiesOwned: 5,
      copiesAvailable: 2,
      numberOfHolds: 0,
      isAvailable: true,
    },
    formatType: "ebook",
    libraryKey: "lapl",
    ...overrides,
  };
}

function makeWork(overrides: Partial<AuthorBookResult> = {}): AuthorBookResult {
  return {
    title: "Test Book",
    olWorkKey: "/works/OL1W",
    libbyResults: [],
    ...overrides,
  };
}

describe("categorizeWork", () => {
  it("returns 'not_found' when no libby results", () => {
    expect(categorizeWork(makeWork())).toBe("not_found");
  });

  it("returns 'available' when a result is available", () => {
    const work = makeWork({
      libbyResults: [makeLibbyResult()],
    });
    expect(categorizeWork(work)).toBe("available");
  });

  it("returns 'soon' when best ETA is <= 14 days", () => {
    const work = makeWork({
      libbyResults: [
        makeLibbyResult({
          availability: {
            id: "m1",
            copiesOwned: 3,
            copiesAvailable: 0,
            numberOfHolds: 2,
            isAvailable: false,
            estimatedWaitDays: 7,
          },
        }),
      ],
    });
    expect(categorizeWork(work)).toBe("soon");
  });

  it("returns 'waiting' when best ETA is > 14 days", () => {
    const work = makeWork({
      libbyResults: [
        makeLibbyResult({
          availability: {
            id: "m1",
            copiesOwned: 3,
            copiesAvailable: 0,
            numberOfHolds: 20,
            isAvailable: false,
            estimatedWaitDays: 42,
          },
        }),
      ],
    });
    expect(categorizeWork(work)).toBe("waiting");
  });

  it("filters by format when formatFilter is specified", () => {
    const work = makeWork({
      libbyResults: [makeLibbyResult({ formatType: "audiobook" })],
    });
    // ebook filter should not see the audiobook result
    expect(categorizeWork(work, "ebook")).toBe("not_found");
    expect(categorizeWork(work, "audiobook")).toBe("available");
    expect(categorizeWork(work, "all")).toBe("available");
  });

  it("returns 'waiting' when estimatedWaitDays is exactly 15", () => {
    const work = makeWork({
      libbyResults: [
        makeLibbyResult({
          availability: {
            id: "m1",
            copiesOwned: 3,
            copiesAvailable: 0,
            numberOfHolds: 5,
            isAvailable: false,
            estimatedWaitDays: 15,
          },
        }),
      ],
    });
    expect(categorizeWork(work)).toBe("waiting");
  });

  it("returns 'soon' when estimatedWaitDays is exactly 14", () => {
    const work = makeWork({
      libbyResults: [
        makeLibbyResult({
          availability: {
            id: "m1",
            copiesOwned: 3,
            copiesAvailable: 0,
            numberOfHolds: 5,
            isAvailable: false,
            estimatedWaitDays: 14,
          },
        }),
      ],
    });
    expect(categorizeWork(work)).toBe("soon");
  });

  it("returns 'available' even if some results are waiting", () => {
    const work = makeWork({
      libbyResults: [
        makeLibbyResult({
          availability: {
            id: "m1",
            copiesOwned: 3,
            copiesAvailable: 0,
            numberOfHolds: 20,
            isAvailable: false,
            estimatedWaitDays: 42,
          },
        }),
        makeLibbyResult(), // available
      ],
    });
    expect(categorizeWork(work)).toBe("available");
  });
});

describe("bestAuthorCategory", () => {
  it("returns 'not_found' for empty works", () => {
    expect(bestAuthorCategory([], "all")).toBe("not_found");
  });

  it("returns best category across works", () => {
    const works = [
      makeWork(), // not_found
      makeWork({
        libbyResults: [
          makeLibbyResult({
            availability: {
              id: "m1",
              copiesOwned: 3,
              copiesAvailable: 0,
              numberOfHolds: 20,
              isAvailable: false,
              estimatedWaitDays: 42,
            },
          }),
        ],
      }), // waiting
    ];
    expect(bestAuthorCategory(works, "all")).toBe("waiting");
  });

  it("returns 'available' and short-circuits", () => {
    const works = [
      makeWork({ libbyResults: [makeLibbyResult()] }), // available
      makeWork(), // not_found
    ];
    expect(bestAuthorCategory(works, "all")).toBe("available");
  });

  it("respects format filter", () => {
    const works = [
      makeWork({
        libbyResults: [makeLibbyResult({ formatType: "audiobook" })],
      }),
    ];
    expect(bestAuthorCategory(works, "ebook")).toBe("not_found");
    expect(bestAuthorCategory(works, "audiobook")).toBe("available");
  });
});

describe("CATEGORY_ORDER", () => {
  it("has correct ordering", () => {
    expect(CATEGORY_ORDER.available).toBeLessThan(CATEGORY_ORDER.soon);
    expect(CATEGORY_ORDER.soon).toBeLessThan(CATEGORY_ORDER.waiting);
    expect(CATEGORY_ORDER.waiting).toBeLessThan(CATEGORY_ORDER.not_found);
  });
});
