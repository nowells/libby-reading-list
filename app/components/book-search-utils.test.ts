import { describe, it, expect } from "vitest";
import { getAuthor, normalizeForDedup, deduplicateItems } from "./book-search-utils";
import type { LibbyMediaItem } from "~/lib/libby";

function makeItem(overrides: Partial<LibbyMediaItem> = {}): LibbyMediaItem {
  return {
    id: "item-1",
    title: "Test Book",
    sortTitle: "test book",
    type: { id: "ebook-kindle", name: "eBook" },
    formats: [],
    creators: [{ name: "Jane Author", role: "Author" }],
    ...overrides,
  };
}

describe("getAuthor", () => {
  it("returns the Author-role creator name", () => {
    const item = makeItem({
      creators: [
        { name: "Narrator Person", role: "Narrator" },
        { name: "Jane Author", role: "Author" },
      ],
    });
    expect(getAuthor(item)).toBe("Jane Author");
  });

  it("returns empty string when no Author role exists", () => {
    const item = makeItem({ creators: [{ name: "Narrator", role: "Narrator" }] });
    expect(getAuthor(item)).toBe("");
  });

  it("returns empty string when creators is empty", () => {
    const item = makeItem({ creators: [] });
    expect(getAuthor(item)).toBe("");
  });

  it("returns first Author when multiple exist", () => {
    const item = makeItem({
      creators: [
        { name: "First Author", role: "Author" },
        { name: "Second Author", role: "Author" },
      ],
    });
    expect(getAuthor(item)).toBe("First Author");
  });
});

describe("normalizeForDedup", () => {
  it("lowercases and strips non-alphanumeric chars", () => {
    expect(normalizeForDedup("Hello, World!")).toBe("helloworld");
  });

  it("removes spaces", () => {
    expect(normalizeForDedup("the great gatsby")).toBe("thegreatgatsby");
  });

  it("preserves numbers", () => {
    expect(normalizeForDedup("Catch-22")).toBe("catch22");
  });

  it("handles empty string", () => {
    expect(normalizeForDedup("")).toBe("");
  });

  it("handles all-special-chars string", () => {
    expect(normalizeForDedup("!@#$%")).toBe("");
  });
});

describe("deduplicateItems", () => {
  it("returns empty array for empty input", () => {
    expect(deduplicateItems([])).toEqual([]);
  });

  it("keeps unique items", () => {
    const items = [
      makeItem({ id: "1", sortTitle: "book a" }),
      makeItem({ id: "2", sortTitle: "book b" }),
    ];
    expect(deduplicateItems(items)).toHaveLength(2);
  });

  it("deduplicates by normalized sortTitle + creator", () => {
    const items = [
      makeItem({ id: "1", sortTitle: "Book A" }),
      makeItem({ id: "2", sortTitle: "book a" }),
    ];
    expect(deduplicateItems(items)).toHaveLength(1);
  });

  it("keeps both if different authors", () => {
    const items = [
      makeItem({
        id: "1",
        sortTitle: "Book A",
        creators: [{ name: "Author One", role: "Author" }],
      }),
      makeItem({
        id: "2",
        sortTitle: "Book A",
        creators: [{ name: "Author Two", role: "Author" }],
      }),
    ];
    expect(deduplicateItems(items)).toHaveLength(2);
  });

  it("prefers item with cover art when duplicated", () => {
    const noCover = makeItem({ id: "1", sortTitle: "book" });
    const hasCover = makeItem({
      id: "2",
      sortTitle: "book",
      covers: { cover150Wide: { href: "https://example.com/cover.jpg" } },
    });
    const result = deduplicateItems([noCover, hasCover]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("2");
  });

  it("keeps first item when both have covers", () => {
    const cover1 = makeItem({
      id: "1",
      sortTitle: "book",
      covers: { cover150Wide: { href: "https://example.com/a.jpg" } },
    });
    const cover2 = makeItem({
      id: "2",
      sortTitle: "book",
      covers: { cover150Wide: { href: "https://example.com/b.jpg" } },
    });
    const result = deduplicateItems([cover1, cover2]);
    expect(result[0].id).toBe("1");
  });

  it("uses firstCreatorSortName when available", () => {
    const item1 = makeItem({
      id: "1",
      sortTitle: "book",
      firstCreatorSortName: "Author, Jane",
      creators: [{ name: "Jane Author", role: "Author" }],
    });
    const item2 = makeItem({
      id: "2",
      sortTitle: "book",
      firstCreatorSortName: "Author, Jane",
      creators: [{ name: "Jane Author", role: "Author" }],
    });
    expect(deduplicateItems([item1, item2])).toHaveLength(1);
  });

  it("treats different firstCreatorSortName as distinct", () => {
    const item1 = makeItem({
      id: "1",
      sortTitle: "book",
      firstCreatorSortName: "Author, Jane",
    });
    const item2 = makeItem({
      id: "2",
      sortTitle: "book",
      firstCreatorSortName: "Writer, John",
    });
    expect(deduplicateItems([item1, item2])).toHaveLength(2);
  });
});
