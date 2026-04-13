import { describe, it, expect, beforeEach } from "vitest";
import { getCached, setCached } from "./cache";
import type { BookAvailability } from "~/lib/libby";

function makeAvailability(estimatedWaitDays?: number): BookAvailability {
  return {
    bookTitle: "Test Book",
    bookAuthor: "Test Author",
    results: estimatedWaitDays != null
      ? [{
          mediaItem: { id: "1", title: "Test Book", sortTitle: "test book", type: { id: "ebook", name: "eBook" }, formats: [], creators: [] },
          availability: { id: "1", copiesOwned: 1, copiesAvailable: 0, numberOfHolds: 5, isAvailable: false, estimatedWaitDays },
          matchScore: 0.9,
          formatType: "ebook",
          libraryKey: "test-lib",
        }]
      : [],
  };
}

describe("cache", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null for uncached book", () => {
    expect(getCached("unknown-id")).toBeNull();
  });

  it("stores and retrieves cached data", () => {
    const data = makeAvailability(14);
    setCached("book-1", data);
    const cached = getCached("book-1");
    expect(cached).not.toBeNull();
    expect(cached!.data.bookTitle).toBe("Test Book");
  });

  it("respects cache expiration for short wait times", () => {
    const data = makeAvailability(0);
    setCached("book-2", data);

    // Manually expire the entry by backdating fetchedAt
    const raw = JSON.parse(localStorage.getItem("shelfcheck:availability")!);
    raw["book-2"].fetchedAt = Date.now() - 3 * 60 * 60 * 1000; // 3 hours ago
    localStorage.setItem("shelfcheck:availability", JSON.stringify(raw));

    expect(getCached("book-2")).toBeNull();
  });

  it("keeps cache valid within TTL for long wait times", () => {
    const data = makeAvailability(30); // 30 day wait → 15 day half-life
    setCached("book-3", data);

    // 1 hour ago should still be valid
    const raw = JSON.parse(localStorage.getItem("shelfcheck:availability")!);
    raw["book-3"].fetchedAt = Date.now() - 60 * 60 * 1000;
    localStorage.setItem("shelfcheck:availability", JSON.stringify(raw));

    expect(getCached("book-3")).not.toBeNull();
  });
});
