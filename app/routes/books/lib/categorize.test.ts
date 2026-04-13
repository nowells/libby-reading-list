import { describe, it, expect } from "vitest";
import {
  categorizeBook,
  categorizeBookWithFormat,
  categoryScore,
  type BookAvailState,
} from "./categorize";

function makeState(overrides: Partial<BookAvailState> = {}): BookAvailState {
  return { status: "done", ...overrides };
}

function makeResult(isAvailable: boolean, estimatedWaitDays?: number, formatType = "ebook") {
  return {
    mediaItem: {
      id: "1",
      title: "Book",
      sortTitle: "book",
      type: { id: formatType, name: formatType },
      formats: [],
      creators: [],
    },
    availability: {
      id: "1",
      copiesOwned: 1,
      copiesAvailable: isAvailable ? 1 : 0,
      numberOfHolds: 0,
      isAvailable,
      estimatedWaitDays,
    },
    matchScore: 0.9,
    formatType,
    libraryKey: "lib",
  };
}

describe("categorizeBook", () => {
  it("returns pending for undefined state", () => {
    expect(categorizeBook(undefined)).toBe("pending");
  });

  it("returns pending for loading state without data", () => {
    expect(categorizeBook(makeState({ status: "loading" }))).toBe("pending");
  });

  it("returns not_found when no results", () => {
    expect(
      categorizeBook(makeState({ data: { bookTitle: "X", bookAuthor: "Y", results: [] } })),
    ).toBe("not_found");
  });

  it("returns available when a result is available", () => {
    expect(
      categorizeBook(
        makeState({
          data: { bookTitle: "X", bookAuthor: "Y", results: [makeResult(true)] },
        }),
      ),
    ).toBe("available");
  });

  it("returns soon for short wait", () => {
    expect(
      categorizeBook(
        makeState({
          data: { bookTitle: "X", bookAuthor: "Y", results: [makeResult(false, 7)] },
        }),
      ),
    ).toBe("soon");
  });

  it("returns waiting for long wait", () => {
    expect(
      categorizeBook(
        makeState({
          data: { bookTitle: "X", bookAuthor: "Y", results: [makeResult(false, 30)] },
        }),
      ),
    ).toBe("waiting");
  });
});

describe("categorizeBookWithFormat", () => {
  it("filters by format type", () => {
    const state = makeState({
      data: {
        bookTitle: "X",
        bookAuthor: "Y",
        results: [makeResult(true, undefined, "audiobook")],
      },
    });
    expect(categorizeBookWithFormat(state, "ebook")).toBe("not_found");
    expect(categorizeBookWithFormat(state, "audiobook")).toBe("available");
    expect(categorizeBookWithFormat(state, "all")).toBe("available");
  });
});

describe("categoryScore", () => {
  it("ranks categories correctly", () => {
    expect(categoryScore("available")).toBeGreaterThan(categoryScore("soon"));
    expect(categoryScore("soon")).toBeGreaterThan(categoryScore("waiting"));
    expect(categoryScore("waiting")).toBeGreaterThan(categoryScore("not_found"));
    expect(categoryScore("not_found")).toBeGreaterThan(categoryScore("pending"));
  });
});
