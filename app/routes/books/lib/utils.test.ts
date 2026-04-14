import { describe, it, expect } from "vitest";
import { timeAgo, libbyTitleUrl, PAGE_SIZE, formatDuration, fuzzyMatch } from "./utils";

describe("timeAgo", () => {
  it("returns 'just now' for recent timestamps", () => {
    expect(timeAgo(Date.now())).toBe("just now");
  });

  it("returns minutes for short durations", () => {
    expect(timeAgo(Date.now() - 5 * 60 * 1000)).toBe("5m ago");
  });

  it("returns hours for medium durations", () => {
    expect(timeAgo(Date.now() - 3 * 60 * 60 * 1000)).toBe("3h ago");
  });

  it("returns days for long durations", () => {
    expect(timeAgo(Date.now() - 2 * 24 * 60 * 60 * 1000)).toBe("2d ago");
  });
});

describe("libbyTitleUrl", () => {
  it("generates correct Libby URL", () => {
    expect(libbyTitleUrl("mylib", "12345")).toBe(
      "https://libbyapp.com/library/mylib/everything/page-1/12345",
    );
  });
});

describe("PAGE_SIZE", () => {
  it("is a reasonable number", () => {
    expect(PAGE_SIZE).toBeGreaterThan(0);
    expect(PAGE_SIZE).toBeLessThanOrEqual(100);
  });
});

describe("formatDuration", () => {
  it("formats hours and minutes", () => {
    expect(formatDuration("12:34:56")).toBe("12h 34m");
  });

  it("formats hours only when no minutes", () => {
    expect(formatDuration("5:00:00")).toBe("5h");
  });

  it("formats minutes only for short durations", () => {
    expect(formatDuration("0:45:00")).toBe("45m");
  });
});

describe("fuzzyMatch", () => {
  it("matches exact substring", () => {
    expect(fuzzyMatch("storm", "The Stormlight Archive", "Brandon Sanderson")).toBe(true);
  });

  it("matches multiple terms", () => {
    expect(fuzzyMatch("brandon storm", "The Stormlight Archive", "Brandon Sanderson")).toBe(true);
  });

  it("matches with subsequence (skipped chars)", () => {
    expect(fuzzyMatch("brndn", "The Stormlight Archive", "Brandon Sanderson")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(fuzzyMatch("BRANDON", "The Stormlight Archive", "Brandon Sanderson")).toBe(true);
  });

  it("returns true for empty query", () => {
    expect(fuzzyMatch("", "Any Title", "Any Author")).toBe(true);
    expect(fuzzyMatch("   ", "Any Title", "Any Author")).toBe(true);
  });

  it("rejects non-matching terms", () => {
    expect(fuzzyMatch("tolkien", "The Stormlight Archive", "Brandon Sanderson")).toBe(false);
  });

  it("matches prefix of a word", () => {
    expect(fuzzyMatch("sand", "The Stormlight Archive", "Brandon Sanderson")).toBe(true);
  });
});
