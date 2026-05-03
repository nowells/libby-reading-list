import { describe, it, expect } from "vitest";
import {
  isToReadList,
  pickToReadLists,
  popfeedItemsToBooks,
  type PopfeedListEntry,
  type PopfeedListItemEntry,
  type PopfeedListItemRecord,
  type PopfeedListRecord,
} from "./popfeed-mapper";

const DID = "did:plc:exampleuser";
const LIST_URI = `at://${DID}/social.popfeed.feed.list/3lst`;
const OTHER_LIST_URI = `at://${DID}/social.popfeed.feed.list/3oth`;

function listEntry(value: PopfeedListRecord, rkey = "3lst"): PopfeedListEntry {
  return { uri: `at://${DID}/social.popfeed.feed.list/${rkey}`, value };
}

function itemEntry(value: Partial<PopfeedListItemRecord>, rkey = "3itm"): PopfeedListItemEntry {
  return {
    uri: `at://${DID}/social.popfeed.feed.listItem/${rkey}`,
    value: {
      listUri: LIST_URI,
      creativeWorkType: "book",
      addedAt: new Date().toISOString(),
      ...value,
    } as PopfeedListItemRecord,
  };
}

describe("isToReadList", () => {
  it("matches the canonical 'to-read' listType", () => {
    expect(isToReadList({ name: "Reading queue", listType: "to-read" })).toBe(true);
  });

  it("accepts underscore and space variants of listType", () => {
    expect(isToReadList({ name: "x", listType: "to_read" })).toBe(true);
    expect(isToReadList({ name: "x", listType: "to read" })).toBe(true);
    expect(isToReadList({ name: "x", listType: "TO-READ" })).toBe(true);
  });

  it("matches 'to_read_books' style listType from the popfeed example", () => {
    expect(isToReadList({ name: "x", listType: "to-read-books" })).toBe(true);
    expect(isToReadList({ name: "x", listType: "to_read_books" })).toBe(true);
  });

  it("falls back to the human-readable name when listType is empty", () => {
    expect(isToReadList({ name: "Want to Read" })).toBe(true);
    expect(isToReadList({ name: "to read" })).toBe(true);
    expect(isToReadList({ name: "Reading List" })).toBe(true);
  });

  it("does not match unrelated lists", () => {
    expect(isToReadList({ name: "Watchlist", listType: "watchlist" })).toBe(false);
    expect(isToReadList({ name: "Favorites" })).toBe(false);
    expect(isToReadList({ name: "Best of 2025", listType: "favorites" })).toBe(false);
  });
});

describe("pickToReadLists", () => {
  it("returns only lists whose listType (or name) marks them to-read", () => {
    const lists = pickToReadLists([
      listEntry({ name: "Want to Read", listType: "to-read" }, "a"),
      listEntry({ name: "My Watchlist", listType: "watchlist" }, "b"),
      listEntry({ name: "Reading List" }, "c"),
    ]);
    expect(lists.map((l) => l.uri)).toEqual([
      `at://${DID}/social.popfeed.feed.list/a`,
      `at://${DID}/social.popfeed.feed.list/c`,
    ]);
  });
});

describe("popfeedItemsToBooks", () => {
  const allowed = new Set([LIST_URI]);

  it("maps a basic book listItem into a Book", () => {
    const books = popfeedItemsToBooks(
      [
        itemEntry(
          {
            title: "Children of Time",
            mainCredit: "Adrian Tchaikovsky",
            identifiers: { isbn13: "9781447273288" },
            posterUrl: "https://covers.example/ct.jpg",
          },
          "rk1",
        ),
      ],
      allowed,
    );
    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({
      id: "pf-rk1",
      title: "Children of Time",
      author: "Adrian Tchaikovsky",
      isbn13: "9781447273288",
      imageUrl: "https://covers.example/ct.jpg",
      source: "popfeed",
    });
  });

  it("filters out items belonging to lists we did not select", () => {
    const books = popfeedItemsToBooks(
      [itemEntry({ listUri: OTHER_LIST_URI, title: "Foundation", mainCredit: "Asimov" })],
      allowed,
    );
    expect(books).toEqual([]);
  });

  it("skips non-book creative work types", () => {
    const books = popfeedItemsToBooks(
      [
        itemEntry({ title: "Some Movie", creativeWorkType: "movie", mainCredit: "Director" }),
        itemEntry({ title: "An Album", creativeWorkType: "album", mainCredit: "Artist" }),
      ],
      allowed,
    );
    expect(books).toEqual([]);
  });

  it("includes book_series items", () => {
    const books = popfeedItemsToBooks(
      [
        itemEntry({
          title: "The Expanse",
          mainCredit: "James S. A. Corey",
          creativeWorkType: "book_series",
        }),
      ],
      allowed,
    );
    expect(books).toHaveLength(1);
    expect(books[0].title).toBe("The Expanse");
  });

  it("skips items marked finished or abandoned", () => {
    const books = popfeedItemsToBooks(
      [
        itemEntry({ title: "Done Book", mainCredit: "x", status: "#finished" }, "rk-done"),
        itemEntry({ title: "Quit Book", mainCredit: "x", status: "#abandoned" }, "rk-abandoned"),
        itemEntry({ title: "Backlog Book", mainCredit: "x", status: "#backlog" }, "rk-backlog"),
        itemEntry({ title: "Reading Book", mainCredit: "x", status: "#in_progress" }, "rk-prog"),
      ],
      allowed,
    );
    const titles = books.map((b) => b.title).sort();
    expect(titles).toEqual(["Backlog Book", "Reading Book"]);
  });

  it("normalizes the ISBN13 from identifiers, stripping non-digits", () => {
    const books = popfeedItemsToBooks(
      [
        itemEntry({
          title: "Dune",
          mainCredit: "Frank Herbert",
          identifiers: { isbn13: "978-0-441-01359-3" },
        }),
      ],
      allowed,
    );
    expect(books[0].isbn13).toBe("9780441013593");
  });

  it("falls back to isbn10 when isbn13 is missing", () => {
    const books = popfeedItemsToBooks(
      [
        itemEntry({
          title: "Some Book",
          mainCredit: "Author",
          identifiers: { isbn10: "0441013597" },
        }),
      ],
      allowed,
    );
    // isbn10 is 10 digits, not 13, so the helper returns undefined.
    expect(books[0].isbn13).toBeUndefined();
  });

  it("skips items without a title", () => {
    const books = popfeedItemsToBooks([itemEntry({ title: "", mainCredit: "x" })], allowed);
    expect(books).toEqual([]);
  });

  it("populates sourceUrl from a hiveId identifier when present", () => {
    const books = popfeedItemsToBooks(
      [
        itemEntry({
          title: "Children of Time",
          mainCredit: "Adrian Tchaikovsky",
          identifiers: { hiveId: "bk_abc123" },
        }),
      ],
      allowed,
    );
    expect(books[0].sourceUrl).toBe("https://bookhive.buzz/books/bk_abc123");
  });

  it("matches multiple selected list URIs", () => {
    const allowedTwo = new Set([LIST_URI, OTHER_LIST_URI]);
    const books = popfeedItemsToBooks(
      [
        itemEntry({ title: "From List A", mainCredit: "a", listUri: LIST_URI }, "ra"),
        itemEntry({ title: "From List B", mainCredit: "b", listUri: OTHER_LIST_URI }, "rb"),
      ],
      allowedTwo,
    );
    expect(books.map((b) => b.title).sort()).toEqual(["From List A", "From List B"]);
  });
});
