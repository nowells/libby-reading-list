import { describe, it, expect, beforeEach } from "vitest";
import { addBook, getBooks, isWantToRead, updateBook, type Book } from "./storage";

beforeEach(() => {
  localStorage.clear();
});

describe("isWantToRead", () => {
  it("treats unset and 'wantToRead' as want-to-read", () => {
    expect(isWantToRead({ id: "1", title: "T", author: "A", source: "unknown" })).toBe(true);
    expect(
      isWantToRead({
        id: "1",
        title: "T",
        author: "A",
        source: "unknown",
        status: "wantToRead",
      }),
    ).toBe(true);
  });

  it("excludes other statuses", () => {
    for (const status of ["reading", "finished", "abandoned"] as const) {
      expect(isWantToRead({ id: "1", title: "T", author: "A", source: "unknown", status })).toBe(
        false,
      );
    }
  });
});

describe("updateBook with new fields", () => {
  it("persists status, rating, note, started/finished dates", () => {
    addBook({ title: "Anathem", author: "Neal Stephenson", source: "unknown" });
    const id = getBooks()[0].id;
    updateBook(id, {
      status: "reading",
      rating: 80,
      note: "Stick with it",
      startedAt: "2026-01-15T00:00:00.000Z",
    });
    const updated = getBooks()[0] as Book;
    expect(updated.status).toBe("reading");
    expect(updated.rating).toBe(80);
    expect(updated.note).toBe("Stick with it");
    expect(updated.startedAt).toBe("2026-01-15T00:00:00.000Z");
  });

  it("makes a finished book disappear from the want-to-read view", () => {
    addBook({ title: "Anathem", author: "Neal Stephenson", source: "unknown" });
    const id = getBooks()[0].id;
    expect(getBooks().filter(isWantToRead)).toHaveLength(1);
    updateBook(id, { status: "finished", finishedAt: "2026-02-01T00:00:00.000Z" });
    expect(getBooks().filter(isWantToRead)).toHaveLength(0);
    expect(getBooks()).toHaveLength(1);
  });
});
