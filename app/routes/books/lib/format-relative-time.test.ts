import { describe, it, expect, vi, afterEach } from "vitest";
import { formatRelativeTime } from "./format-relative-time";

describe("formatRelativeTime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 'just now' for invalid date string", () => {
    expect(formatRelativeTime("not-a-date")).toBe("just now");
  });

  it("returns 'just now' for time less than 1 minute ago", () => {
    const now = new Date().toISOString();
    expect(formatRelativeTime(now)).toBe("just now");
  });

  it("returns minutes ago for time < 60 minutes", () => {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    expect(formatRelativeTime(thirtyMinAgo)).toBe("30m ago");
  });

  it("returns '1m ago' for exactly 1 minute", () => {
    const oneMinAgo = new Date(Date.now() - 60 * 1000).toISOString();
    expect(formatRelativeTime(oneMinAgo)).toBe("1m ago");
  });

  it("returns '59m ago' for 59 minutes", () => {
    const fiftyNineMinAgo = new Date(Date.now() - 59 * 60 * 1000).toISOString();
    expect(formatRelativeTime(fiftyNineMinAgo)).toBe("59m ago");
  });

  it("returns hours ago for time < 24 hours", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(twoHoursAgo)).toBe("2h ago");
  });

  it("returns '1h ago' for exactly 60 minutes", () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(oneHourAgo)).toBe("1h ago");
  });

  it("returns days ago for time >= 24 hours", () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(twoDaysAgo)).toBe("2d ago");
  });

  it("returns '1d ago' for exactly 24 hours", () => {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(oneDayAgo)).toBe("1d ago");
  });

  it("handles empty string", () => {
    expect(formatRelativeTime("")).toBe("just now");
  });
});
