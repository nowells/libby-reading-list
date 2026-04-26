import { describe, it, expect, vi, beforeEach } from "vitest";
import { attachSession, detachSession, resync } from "./sync";
import * as records from "./records";
import * as storage from "../storage";
import {
  NSID,
  STATUS,
  type ShelfEntryRecord,
  type AuthorFollowRecord,
  type BookDismissedRecord,
} from "./lexicon";

// Mock records module
vi.mock("./records", () => ({
  listRecords: vi.fn(),
  putRecord: vi.fn(),
  deleteRecord: vi.fn(),
}));

const fakeSession = { did: "did:plc:test123" } as never;

function makeShelfPdsRecord(overrides: Partial<ShelfEntryRecord> = {}): ShelfEntryRecord {
  return {
    status: STATUS.wantToRead,
    title: "PDS Book",
    authors: [{ name: "PDS Author" }],
    ids: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    detachSession();
  });

  describe("detachSession", () => {
    it("can be called multiple times safely", () => {
      detachSession();
      detachSession();
    });
  });

  describe("resync", () => {
    it("is a no-op when no session is attached", async () => {
      await resync();
      expect(records.listRecords).not.toHaveBeenCalled();
    });
  });

  describe("attachSession", () => {
    it("calls listRecords for all three collections on attach", async () => {
      vi.mocked(records.listRecords).mockResolvedValue([]);
      vi.mocked(records.putRecord).mockResolvedValue({ uri: "at://test/col/k", rkey: "k" });

      await attachSession(fakeSession);

      expect(records.listRecords).toHaveBeenCalledWith(fakeSession, NSID.shelfEntry);
      expect(records.listRecords).toHaveBeenCalledWith(fakeSession, NSID.authorFollow);
      expect(records.listRecords).toHaveBeenCalledWith(fakeSession, NSID.bookDismissed);
    });

    it("pushes local books to PDS when PDS is empty (bootstrap)", async () => {
      // Set up a local book
      storage.addBook({ title: "Local Book", author: "Local Author", source: "goodreads" });

      vi.mocked(records.listRecords).mockResolvedValue([]);
      vi.mocked(records.putRecord).mockResolvedValue({ uri: "at://test/col/k", rkey: "newrkey" });

      await attachSession(fakeSession, { bootstrap: true });

      // putRecord should have been called to push the local book
      expect(records.putRecord).toHaveBeenCalled();
    });

    it("pulls new books from PDS when local is empty", async () => {
      const pdsRecord = makeShelfPdsRecord({ title: "Remote Book", ids: { olWorkId: "OL123W" } });

      vi.mocked(records.listRecords).mockImplementation(async (_session, collection) => {
        if (collection === NSID.shelfEntry) {
          return [{ uri: "at://test/col/r1", rkey: "r1", value: pdsRecord }];
        }
        return [];
      });

      await attachSession(fakeSession);

      // The book should now exist in local storage
      const books = storage.getBooks();
      const remote = books.find((b) => b.title === "Remote Book");
      expect(remote).toBeDefined();
      expect(remote?.pdsRkey).toBe("r1");
    });

    it("pulls new authors from PDS", async () => {
      const authorRecord: AuthorFollowRecord = {
        name: "Remote Author",
        createdAt: new Date().toISOString(),
      };

      vi.mocked(records.listRecords).mockImplementation(async (_session, collection) => {
        if (collection === NSID.authorFollow) {
          return [{ uri: "at://test/col/a1", rkey: "a1", value: authorRecord }];
        }
        return [];
      });

      await attachSession(fakeSession);

      const authors = storage.getAuthors();
      const remote = authors.find((a) => a.name === "Remote Author");
      expect(remote).toBeDefined();
    });

    it("pulls new dismissed works from PDS", async () => {
      const dismissedRecord: BookDismissedRecord = {
        title: "Dismissed Book",
        authors: [{ name: "D Author" }],
        ids: { olWorkId: "OL999W" },
        createdAt: new Date().toISOString(),
      };

      vi.mocked(records.listRecords).mockImplementation(async (_session, collection) => {
        if (collection === NSID.bookDismissed) {
          return [{ uri: "at://test/col/d1", rkey: "d1", value: dismissedRecord }];
        }
        return [];
      });

      await attachSession(fakeSession);

      const dismissed = storage.getDismissedWorks();
      expect(dismissed.some((d) => d.key.includes("OL999W"))).toBe(true);
    });

    it("does not duplicate existing local books that match PDS records", async () => {
      // Add a local book
      storage.addBook({
        title: "Shared Book",
        author: "Shared Author",
        source: "goodreads",
        workId: "OL555W",
      });
      const initialCount = storage.getBooks().length;

      const pdsRecord = makeShelfPdsRecord({
        title: "Shared Book",
        authors: [{ name: "Shared Author" }],
        ids: { olWorkId: "OL555W" },
      });

      vi.mocked(records.listRecords).mockImplementation(async (_session, collection) => {
        if (collection === NSID.shelfEntry) {
          return [{ uri: "at://test/col/s1", rkey: "s1", value: pdsRecord }];
        }
        return [];
      });

      await attachSession(fakeSession);

      // Should not have added a duplicate
      expect(storage.getBooks().length).toBe(initialCount);
    });

    it("assigns rkey to existing local book that matches PDS", async () => {
      storage.addBook({
        title: "Match Book",
        author: "Match Author",
        source: "goodreads",
        workId: "OL777W",
      });

      const pdsRecord = makeShelfPdsRecord({
        title: "Match Book",
        authors: [{ name: "Match Author" }],
        ids: { olWorkId: "OL777W" },
      });

      vi.mocked(records.listRecords).mockImplementation(async (_session, collection) => {
        if (collection === NSID.shelfEntry) {
          return [{ uri: "at://test/col/m1", rkey: "m1", value: pdsRecord }];
        }
        return [];
      });

      await attachSession(fakeSession);

      const book = storage.getBooks().find((b) => b.workId === "OL777W");
      expect(book?.pdsRkey).toBe("m1");
    });
  });

  describe("mutation mirroring", () => {
    it("pushes a new book to PDS when added locally after attach", async () => {
      vi.mocked(records.listRecords).mockResolvedValue([]);
      vi.mocked(records.putRecord).mockResolvedValue({ uri: "at://test/col/k", rkey: "pushed" });

      await attachSession(fakeSession);

      // Clear the calls from attach reconcile
      vi.mocked(records.putRecord).mockClear();

      // Add a book locally — should trigger mutation handler
      storage.addBook({ title: "New After Attach", author: "Author", source: "goodreads" });

      // Give the async handler a tick
      await new Promise((r) => setTimeout(r, 50));

      expect(records.putRecord).toHaveBeenCalled();
    });

    it("deletes from PDS when a book with pdsRkey is removed locally", async () => {
      vi.mocked(records.listRecords).mockResolvedValue([]);
      vi.mocked(records.putRecord).mockResolvedValue({ uri: "at://test/col/k", rkey: "pushed" });
      vi.mocked(records.deleteRecord).mockResolvedValue(undefined);

      await attachSession(fakeSession);

      // Add a book and give it a pdsRkey
      storage.addBook({ title: "To Delete", author: "Author", source: "goodreads" });
      await new Promise((r) => setTimeout(r, 50));
      const books = storage.getBooks();
      const book = books.find((b) => b.title === "To Delete");
      if (book) {
        storage._setBookPdsRkey(book.id, "delrkey");
        vi.mocked(records.deleteRecord).mockClear();
        storage.removeBook(book.id);
        await new Promise((r) => setTimeout(r, 50));
        expect(records.deleteRecord).toHaveBeenCalled();
      }
    });

    it("stops mirroring after detach", async () => {
      vi.mocked(records.listRecords).mockResolvedValue([]);
      vi.mocked(records.putRecord).mockResolvedValue({ uri: "at://test/col/k", rkey: "k" });

      await attachSession(fakeSession);
      vi.mocked(records.putRecord).mockClear();

      detachSession();

      storage.addBook({ title: "After Detach", author: "Author", source: "goodreads" });
      await new Promise((r) => setTimeout(r, 50));

      // putRecord should NOT have been called after detach
      expect(records.putRecord).not.toHaveBeenCalled();
    });
  });
});
