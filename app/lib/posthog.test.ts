import { describe, it, expect } from "vitest";
import { normalizePathname, posthogBeforeSend } from "./posthog";

describe("normalizePathname", () => {
  it("returns the pattern for static routes", () => {
    expect(normalizePathname("/")).toBe("/");
    expect(normalizePathname("/books")).toBe("/books");
    expect(normalizePathname("/setup")).toBe("/setup");
    expect(normalizePathname("/friends")).toBe("/friends");
  });

  it("collapses dynamic book paths to /book/:workId", () => {
    expect(normalizePathname("/book/OL12345W")).toBe("/book/:workId");
    expect(normalizePathname("/book/anything")).toBe("/book/:workId");
  });

  it("collapses dynamic author paths to /author/:authorKey", () => {
    expect(normalizePathname("/author/OL99A")).toBe("/author/:authorKey");
  });

  it("collapses dynamic friend paths to /friends/:handle", () => {
    expect(normalizePathname("/friends/alice.bsky.social")).toBe("/friends/:handle");
  });

  it("prefers the static /friends route over the dynamic one", () => {
    expect(normalizePathname("/friends")).toBe("/friends");
  });

  it("returns null for unknown paths", () => {
    expect(normalizePathname("/nope")).toBeNull();
    expect(normalizePathname("/book/OL1W/extra")).toBeNull();
  });
});

describe("posthogBeforeSend", () => {
  it("rewrites $pathname and $current_url for $pageview events", () => {
    const event = posthogBeforeSend({
      event: "$pageview",
      properties: {
        $pathname: "/book/OL12345W",
        $current_url: "https://shelfcheck.org/book/OL12345W?ref=foo",
      },
    });
    expect(event?.properties?.$pathname).toBe("/book/:workId");
    expect(event?.properties?.$current_url).toBe("https://shelfcheck.org/book/:workId?ref=foo");
  });

  it("rewrites $prev_pageview properties for $pageleave events", () => {
    const event = posthogBeforeSend({
      event: "$pageleave",
      properties: {
        $pathname: "/author/OL1A",
        $prev_pageview_pathname: "/book/OL2W",
        $prev_pageview_url: "https://shelfcheck.org/book/OL2W",
      },
    });
    expect(event?.properties?.$pathname).toBe("/author/:authorKey");
    expect(event?.properties?.$prev_pageview_pathname).toBe("/book/:workId");
    expect(event?.properties?.$prev_pageview_url).toBe("https://shelfcheck.org/book/:workId");
  });

  it("leaves unknown paths unchanged", () => {
    const event = posthogBeforeSend({
      event: "$pageview",
      properties: {
        $pathname: "/totally-unmapped",
        $current_url: "https://shelfcheck.org/totally-unmapped",
      },
    });
    expect(event?.properties?.$pathname).toBe("/totally-unmapped");
    expect(event?.properties?.$current_url).toBe("https://shelfcheck.org/totally-unmapped");
  });

  it("handles events with no properties", () => {
    expect(posthogBeforeSend({ event: "$pageview" })).toEqual({ event: "$pageview" });
    expect(posthogBeforeSend(null)).toBeNull();
  });

  it("rewrites url props for non-pageview custom events too", () => {
    const event = posthogBeforeSend({
      event: "book_marked_read",
      properties: {
        $current_url: "https://shelfcheck.org/book/OLABCW",
        book_id: "OLABCW",
      },
    });
    expect(event?.properties?.$current_url).toBe("https://shelfcheck.org/book/:workId");
    expect(event?.properties?.book_id).toBe("OLABCW");
  });
});
