import { describe, it, expect } from "vitest";
import {
  timeAgo,
  libbyTitleUrl,
  PAGE_SIZE,
  formatDuration,
  fuzzyMatch,
  formatAudiobookDuration,
} from "./utils";

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

  it("formats MM:SS (2-part) as minutes", () => {
    expect(formatDuration("45:30")).toBe("45m");
  });

  it("returns raw string for unexpected format", () => {
    expect(formatDuration("abc")).toBe("abc");
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

  it("rejects short non-matching subsequences (length < 3)", () => {
    // 2-char term "zx" doesn't match any substring or word prefix, and is too short for subsequence
    expect(fuzzyMatch("zx", "The Stormlight Archive", "Brandon Sanderson")).toBe(false);
  });

  it("rejects out-of-order subsequences", () => {
    // "ndnarb" is "brandon" reversed — subsequence matching checks in-order
    expect(fuzzyMatch("ndnarb", "The Stormlight Archive", "Brandon Sanderson")).toBe(false);
  });
});

describe("formatAudiobookDuration", () => {
  it("returns null for empty results", () => {
    expect(formatAudiobookDuration([])).toBeNull();
  });

  it("returns null when no audiobook formats exist", () => {
    const results = [
      {
        formatType: "ebook",
        mediaItem: { formats: [{ duration: "10:30:00" }] },
      },
    ];
    expect(formatAudiobookDuration(results)).toBeNull();
  });

  it("returns single duration for one audiobook", () => {
    const results = [
      {
        formatType: "audiobook",
        mediaItem: { formats: [{ duration: "13:11:00" }] },
      },
    ];
    expect(formatAudiobookDuration(results)).toBe("13h 11m");
  });

  it("collapses range within 10 minutes to single value", () => {
    const results = [
      {
        formatType: "audiobook",
        mediaItem: { formats: [{ duration: "8:30:00" }] },
      },
      {
        formatType: "audiobook",
        mediaItem: { formats: [{ duration: "8:38:00" }] },
      },
    ];
    expect(formatAudiobookDuration(results)).toBe("8h 38m");
  });

  it("shows range when difference exceeds 10 minutes", () => {
    const results = [
      {
        formatType: "audiobook",
        mediaItem: { formats: [{ duration: "8:30:00" }] },
      },
      {
        formatType: "audiobook",
        mediaItem: { formats: [{ duration: "12:15:00" }] },
      },
    ];
    expect(formatAudiobookDuration(results)).toBe("8h 30m – 12h 15m");
  });

  it("skips formats without duration", () => {
    const results = [
      {
        formatType: "audiobook",
        mediaItem: { formats: [{ duration: "10:00:00" }, {}] },
      },
    ];
    expect(formatAudiobookDuration(results)).toBe("10h");
  });

  it("returns null when audiobook has no durations at all", () => {
    const results = [
      {
        formatType: "audiobook",
        mediaItem: { formats: [{}] },
      },
    ];
    expect(formatAudiobookDuration(results)).toBeNull();
  });

  it("collects durations across multiple results, ignoring ebooks", () => {
    const results = [
      {
        formatType: "ebook",
        mediaItem: { formats: [{ duration: "99:00:00" }] },
      },
      {
        formatType: "audiobook",
        mediaItem: { formats: [{ duration: "5:00:00" }] },
      },
      {
        formatType: "audiobook",
        mediaItem: { formats: [{ duration: "15:30:00" }] },
      },
    ];
    expect(formatAudiobookDuration(results)).toBe("5h – 15h 30m");
  });
});
