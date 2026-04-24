import { describe, it, expect, beforeEach } from "vitest";
import { authorCacheMaxAge, getCachedAuthor, setCachedAuthor, readAuthorCache } from "./cache";

interface MockWork {
  libbyResults: Array<{
    availability: { estimatedWaitDays?: number };
  }>;
}

function makeEntry(works: MockWork[] = [], fetchedAt = Date.now()) {
  return {
    olKey: "OL123A",
    resolvedName: "Test Author",
    works: works as never[],
    fetchedAt,
  };
}

function makeWork(waitDays?: number): MockWork {
  return {
    libbyResults: [{ availability: { estimatedWaitDays: waitDays } }],
  };
}

describe("authorCacheMaxAge", () => {
  it("returns 24h default when no works have wait days", () => {
    const entry = makeEntry([]);
    expect(authorCacheMaxAge(entry)).toBe(24 * 60 * 60 * 1000);
  });

  it("returns 24h when wait days are undefined", () => {
    const entry = makeEntry([makeWork(undefined)]);
    expect(authorCacheMaxAge(entry)).toBe(24 * 60 * 60 * 1000);
  });

  it("computes half-life of shortest wait time", () => {
    // 10 days wait → 5 day half-life = 5 * 24 * 60 * 60 * 1000
    const entry = makeEntry([makeWork(10)]);
    expect(authorCacheMaxAge(entry)).toBe(5 * 24 * 60 * 60 * 1000);
  });

  it("clamps to minimum 2 hours for zero wait days", () => {
    const entry = makeEntry([makeWork(0)]);
    expect(authorCacheMaxAge(entry)).toBe(2 * 60 * 60 * 1000);
  });

  it("clamps to minimum 2 hours for very short wait", () => {
    const entry = makeEntry([makeWork(0.1)]);
    expect(authorCacheMaxAge(entry)).toBe(2 * 60 * 60 * 1000);
  });

  it("uses shortest wait across multiple works", () => {
    const entry = makeEntry([makeWork(30), makeWork(4), makeWork(20)]);
    // Shortest is 4 days → 2 day half-life
    expect(authorCacheMaxAge(entry)).toBe(2 * 24 * 60 * 60 * 1000);
  });

  it("uses shortest wait across multiple libbyResults within a work", () => {
    const work = {
      libbyResults: [
        { availability: { estimatedWaitDays: 30 } },
        { availability: { estimatedWaitDays: 2 } },
      ],
    };
    const entry = makeEntry([work as never]);
    // Shortest is 2 days → 1 day half-life
    expect(authorCacheMaxAge(entry)).toBe(1 * 24 * 60 * 60 * 1000);
  });
});

describe("setCachedAuthor / getCachedAuthor", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores and retrieves a cached author", () => {
    setCachedAuthor("a1", "OL123A", "Test Author", []);
    const cached = getCachedAuthor("a1");
    expect(cached).not.toBeNull();
    expect(cached!.olKey).toBe("OL123A");
    expect(cached!.resolvedName).toBe("Test Author");
  });

  it("returns null for non-existent author", () => {
    expect(getCachedAuthor("nonexistent")).toBeNull();
  });

  it("returns null when entry is expired", () => {
    setCachedAuthor("a1", "OL123A", "Test Author", []);
    // Backdate fetchedAt beyond 24h default TTL
    const raw = JSON.parse(localStorage.getItem("shelfcheck:author-availability")!);
    raw["a1"].fetchedAt = Date.now() - 25 * 60 * 60 * 1000;
    localStorage.setItem("shelfcheck:author-availability", JSON.stringify(raw));

    expect(getCachedAuthor("a1")).toBeNull();
  });

  it("returns entry when within TTL", () => {
    setCachedAuthor("a1", "OL123A", "Test Author", []);
    // 1 hour ago, well within 24h default
    const raw = JSON.parse(localStorage.getItem("shelfcheck:author-availability")!);
    raw["a1"].fetchedAt = Date.now() - 60 * 60 * 1000;
    localStorage.setItem("shelfcheck:author-availability", JSON.stringify(raw));

    expect(getCachedAuthor("a1")).not.toBeNull();
  });

  it("overwrites existing entry", () => {
    setCachedAuthor("a1", "OL123A", "Old Name", []);
    setCachedAuthor("a1", "OL456A", "New Name", []);
    const cached = getCachedAuthor("a1");
    expect(cached!.resolvedName).toBe("New Name");
    expect(cached!.olKey).toBe("OL456A");
  });
});

describe("readAuthorCache", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns empty object when no cache exists", () => {
    expect(readAuthorCache()).toEqual({});
  });

  it("returns all cached entries", () => {
    setCachedAuthor("a1", "OL1A", "Author One", []);
    setCachedAuthor("a2", "OL2A", "Author Two", []);
    const cache = readAuthorCache();
    expect(Object.keys(cache)).toHaveLength(2);
    expect(cache["a1"].resolvedName).toBe("Author One");
    expect(cache["a2"].resolvedName).toBe("Author Two");
  });

  it("handles corrupted JSON gracefully", () => {
    localStorage.setItem("shelfcheck:author-availability", "not-json");
    expect(readAuthorCache()).toEqual({});
  });
});
