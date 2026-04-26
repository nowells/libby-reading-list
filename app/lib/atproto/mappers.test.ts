import { describe, it, expect } from "vitest";
import {
  authorEntryToRecord,
  authorRecordToEntry,
  bookToShelfRecord,
  dismissedRecordToEntry,
  dismissedToRecord,
  readEntryToShelfRecord,
  shelfRecordToBook,
  shelfRecordToReadEntry,
  statusFromToken,
} from "./mappers";
import { STATUS } from "./lexicon";
import type { Book, AuthorEntry, ReadBookEntry, DismissedWorkEntry } from "../storage";

const NOW = new Date("2026-04-26T12:00:00.000Z");

describe("mappers", () => {
  describe("bookToShelfRecord", () => {
    it("emits a record with required fields and Open Library work id", () => {
      const book: Book = {
        id: "gr-1",
        title: "The Three-Body Problem",
        author: "Cixin Liu, Ken Liu",
        source: "goodreads",
        workId: "OL45883W",
        isbn13: "9780765382030",
      };
      const record = bookToShelfRecord(book, STATUS.wantToRead, NOW);
      expect(record.status).toBe("org.shelfcheck.defs#wantToRead");
      expect(record.title).toBe("The Three-Body Problem");
      expect(record.authors).toEqual([{ name: "Cixin Liu" }, { name: "Ken Liu" }]);
      expect(record.ids).toEqual({ olWorkId: "OL45883W", isbn13: "9780765382030" });
      expect(record.source).toBe("goodreads");
      expect(record.createdAt).toBe(NOW.toISOString());
      expect(record.updatedAt).toBe(NOW.toISOString());
    });

    it("falls back to Unknown when no author is present", () => {
      const book: Book = { id: "x", title: "Untitled", author: "", source: "unknown" };
      const record = bookToShelfRecord(book, STATUS.wantToRead, NOW);
      expect(record.authors).toEqual([{ name: "Unknown" }]);
    });

    it("ignores unknown source values rather than emitting them", () => {
      const book: Book = {
        id: "x",
        title: "T",
        author: "A",
        // @ts-expect-error - exercising the unknown-source guard
        source: "totally-not-a-source",
      };
      const record = bookToShelfRecord(book, STATUS.wantToRead, NOW);
      expect(record.source).toBeUndefined();
    });
  });

  describe("shelfRecordToBook", () => {
    it("round-trips a record back into a Book with a deterministic id", () => {
      const book: Book = {
        id: "ignored",
        title: "Project Hail Mary",
        author: "Andy Weir",
        source: "goodreads",
        workId: "OL21422531W",
        isbn13: "9780593135204",
      };
      const record = bookToShelfRecord(book, STATUS.wantToRead, NOW);
      const restored = shelfRecordToBook(record);
      expect(restored.title).toBe("Project Hail Mary");
      expect(restored.author).toBe("Andy Weir");
      expect(restored.workId).toBe("OL21422531W");
      expect(restored.isbn13).toBe("9780593135204");
      expect(restored.id).toBe("pds-ol-OL21422531W");
    });

    it("derives a fuzzy id when no canonical identifier is present", () => {
      const restored = shelfRecordToBook({
        status: STATUS.wantToRead,
        title: "Untitled Work",
        authors: [{ name: "Anonymous" }],
        ids: {},
        createdAt: NOW.toISOString(),
      });
      expect(restored.id).toBe("pds-fuzzy-untitledwork-anonymous");
    });
  });

  describe("read entries", () => {
    it("encodes a finished read as a finished shelf record", () => {
      const entry: ReadBookEntry = {
        key: "work:OL12345W",
        title: "Anathem",
        author: "Neal Stephenson",
        workId: "OL12345W",
        markedAt: Date.parse("2025-08-01T00:00:00.000Z"),
      };
      const record = readEntryToShelfRecord(entry, NOW);
      expect(record.status).toBe(STATUS.finished);
      expect(record.ids.olWorkId).toBe("OL12345W");
      expect(record.finishedAt).toBe("2025-08-01T00:00:00.000Z");
      expect(record.updatedAt).toBe(NOW.toISOString());
    });

    it("round-trips back into a ReadBookEntry with the same content key", () => {
      const original: ReadBookEntry = {
        key: "work:OL12345W",
        title: "Anathem",
        author: "Neal Stephenson",
        workId: "OL12345W",
        markedAt: Date.parse("2025-08-01T00:00:00.000Z"),
      };
      const record = readEntryToShelfRecord(original, NOW);
      const restored = shelfRecordToReadEntry(record);
      expect(restored.key).toBe(original.key);
      expect(restored.workId).toBe(original.workId);
      expect(restored.markedAt).toBe(original.markedAt);
    });
  });

  describe("statusFromToken", () => {
    it("accepts both fully-qualified token refs and bare tokens", () => {
      expect(statusFromToken("org.shelfcheck.defs#wantToRead")).toBe(STATUS.wantToRead);
      expect(statusFromToken("wantToRead")).toBe(STATUS.wantToRead);
      expect(statusFromToken("finished")).toBe(STATUS.finished);
      expect(statusFromToken("garbage")).toBeUndefined();
      expect(statusFromToken(undefined)).toBeUndefined();
    });
  });

  describe("authors", () => {
    it("round-trips an AuthorEntry through the lexicon record shape", () => {
      const author: AuthorEntry = {
        id: "author-local-1",
        name: "Ursula K. Le Guin",
        olKey: "OL27349A",
      };
      const record = authorEntryToRecord(author, NOW);
      expect(record.name).toBe("Ursula K. Le Guin");
      expect(record.olAuthorKey).toBe("OL27349A");
      const restored = authorRecordToEntry(record, "abc123");
      expect(restored.name).toBe("Ursula K. Le Guin");
      expect(restored.olKey).toBe("OL27349A");
      expect(restored.id).toBe("pds-author-abc123");
    });
  });

  describe("dismissed", () => {
    it("returns null when the entry has no portable identifier", () => {
      const entry: DismissedWorkEntry = {
        key: "fuzzy:abc\0def",
        dismissedAt: Date.now(),
      };
      expect(dismissedToRecord(entry, NOW)).toBeNull();
    });

    it("emits a record when a workId is present and round-trips back", () => {
      const entry: DismissedWorkEntry = {
        key: "work:OL999W",
        title: "Some Book",
        author: "Some Author",
        workId: "OL999W",
        dismissedAt: Date.parse("2025-07-15T00:00:00.000Z"),
      };
      const record = dismissedToRecord(entry, NOW);
      expect(record).not.toBeNull();
      expect(record!.ids.olWorkId).toBe("OL999W");
      expect(record!.title).toBe("Some Book");
      expect(record!.authors).toEqual([{ name: "Some Author" }]);

      const restored = dismissedRecordToEntry(record!);
      expect(restored.key).toBe("work:OL999W");
      expect(restored.workId).toBe("OL999W");
      expect(restored.dismissedAt).toBe(entry.dismissedAt);
    });
  });
});
