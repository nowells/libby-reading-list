import { describe, it, expect, vi, beforeEach } from "vitest";
import { attachSession, detachSession, resync } from "./sync";
import * as records from "./records";
import type { ListedRecord } from "./records";
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

    it("pulls new authors from PDS and tags them with pdsRkey for later deletes", async () => {
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
      // Without pdsRkey on the local entry, removeAuthor() can't tell the
      // sync engine which record to delete from the PDS — and a subsequent
      // resync would silently re-pull the same record.
      expect(remote?.pdsRkey).toBe("a1");
    });

    it("merges a locally-added author with PDS records on bootstrap without deleting either side", async () => {
      // Reproduces the user-reported scenario: 1 manually-added author on
      // this device + 6 different authors already on the PDS from another
      // device. After sign-in, local should hold all 7 and the only PDS
      // write should be a single createRecord for the manual author —
      // never a delete.
      storage.addAuthor({ name: "Local Manual Author" });

      const remoteAuthors: ListedRecord<AuthorFollowRecord>[] = Array.from(
        { length: 6 },
        (_, i) => ({
          uri: `at://test/col/r${i}`,
          rkey: `r${i}`,
          value: {
            name: `Remote Author ${i}`,
            olAuthorKey: `OL${1000 + i}A`,
            createdAt: new Date().toISOString(),
          },
        }),
      );

      vi.mocked(records.listRecords).mockImplementation(async (_session, collection) => {
        if (collection === NSID.authorFollow) return remoteAuthors;
        return [];
      });
      vi.mocked(records.putRecord).mockResolvedValue({
        uri: "at://test/col/manual",
        rkey: "manual-rkey",
      });
      vi.mocked(records.deleteRecord).mockResolvedValue();

      await attachSession(fakeSession, { bootstrap: true });

      // All 7 authors are now in local storage.
      const authors = storage.getAuthors();
      expect(authors).toHaveLength(7);
      expect(authors.find((a) => a.name === "Local Manual Author")?.pdsRkey).toBe("manual-rkey");
      for (let i = 0; i < 6; i++) {
        expect(authors.find((a) => a.name === `Remote Author ${i}`)?.pdsRkey).toBe(`r${i}`);
      }

      // Exactly one putRecord — the manual author being pushed up. The 6
      // remote authors must not be re-pushed (they already exist in the
      // PDS) and absolutely no delete should fire.
      expect(records.putRecord).toHaveBeenCalledTimes(1);
      expect(records.deleteRecord).not.toHaveBeenCalled();
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

    it("upgrades the PDS author record in place when a name-only follow gets an OL key", async () => {
      // Reproduces the user-reported "follow author does nothing" symptom:
      // a legacy entry with only a name lives on the PDS. Re-adding the
      // same author with an olKey should patch the existing PDS record via
      // putRecord(rkey) — not create a duplicate.
      vi.mocked(records.listRecords).mockResolvedValue([]);
      vi.mocked(records.putRecord).mockResolvedValue({
        uri: "at://test/col/k",
        rkey: "author-rkey",
      });

      await attachSession(fakeSession);
      // Seed a name-only author with a known pdsRkey.
      storage.addAuthor({ name: "Brandon Sanderson" });
      await new Promise((r) => setTimeout(r, 50));
      const seeded = storage.getAuthors().find((a) => a.name === "Brandon Sanderson");
      expect(seeded).toBeDefined();
      storage._setAuthorPdsRkey(seeded!.id, "author-rkey");

      vi.mocked(records.putRecord).mockClear();

      // Re-adding with the OL key should upgrade the existing entry…
      storage.addAuthor({ name: "Brandon Sanderson", olKey: "OL2700751A" });
      await new Promise((r) => setTimeout(r, 50));

      // …and putRecord should be called WITH the existing rkey, replacing
      // the PDS record in place rather than creating a second one.
      expect(records.putRecord).toHaveBeenCalledTimes(1);
      const call = vi.mocked(records.putRecord).mock.calls[0];
      expect(call[1]).toBe(NSID.authorFollow);
      expect(call[3]).toBe("author-rkey");
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

  describe("PDS-side dedup on reconcile", () => {
    it("removes duplicate shelf entries pointing at the same workId, keeping the richest", async () => {
      // Reproduces the user-reported "many copies of the same book" PDS
      // state: three records share an olWorkId. The richest one (with
      // user rating + note) must survive; the others must be deleted.
      const sharedWorkId = "OL5778777W";
      const records_: ListedRecord<ShelfEntryRecord>[] = [
        {
          uri: "at://test/col/r1",
          rkey: "r1",
          value: makeShelfPdsRecord({
            title: "The Great Gatsby",
            authors: [{ name: "F. Scott Fitzgerald" }],
            ids: { olWorkId: sharedWorkId },
            createdAt: "2025-01-01T00:00:00.000Z",
          }),
        },
        {
          uri: "at://test/col/r2",
          rkey: "r2",
          value: makeShelfPdsRecord({
            title: "The Great Gatsby",
            authors: [{ name: "F. Scott Fitzgerald" }],
            ids: { olWorkId: sharedWorkId },
            createdAt: "2025-02-01T00:00:00.000Z",
            // Richer record — user has rated and reviewed.
            rating: 80,
            note: "A favorite.",
          }),
        },
        {
          uri: "at://test/col/r3",
          rkey: "r3",
          value: makeShelfPdsRecord({
            title: "The Great Gatsby",
            authors: [{ name: "F. Scott Fitzgerald" }],
            ids: { olWorkId: sharedWorkId },
            createdAt: "2025-03-01T00:00:00.000Z",
          }),
        },
      ];

      vi.mocked(records.listRecords).mockImplementation(async (_session, collection) => {
        if (collection === NSID.shelfEntry) return records_;
        return [];
      });
      vi.mocked(records.deleteRecord).mockResolvedValue();

      await attachSession(fakeSession);

      // r1 and r3 (the empty ones) are deleted; r2 (richest) survives.
      expect(records.deleteRecord).toHaveBeenCalledTimes(2);
      const deletedRkeys = vi
        .mocked(records.deleteRecord)
        .mock.calls.map((c) => c[2])
        .sort();
      expect(deletedRkeys).toEqual(["r1", "r3"]);

      // The local book picks up the surviving rkey and the user-edit
      // metadata that record carried.
      const book = storage.getBooks().find((b) => b.workId === sharedWorkId);
      expect(book?.pdsRkey).toBe("r2");
      expect(book?.rating).toBe(80);
      expect(book?.note).toBe("A favorite.");
    });

    it("dedupes shelf entries by fuzzy title+author when olWorkId is missing", async () => {
      const records_: ListedRecord<ShelfEntryRecord>[] = [
        {
          uri: "at://test/col/r1",
          rkey: "r1",
          value: makeShelfPdsRecord({
            title: "Hyperion",
            authors: [{ name: "Dan Simmons" }],
            ids: {},
            createdAt: "2025-01-01T00:00:00.000Z",
          }),
        },
        {
          uri: "at://test/col/r2",
          rkey: "r2",
          value: makeShelfPdsRecord({
            title: "Hyperion",
            authors: [{ name: "Dan Simmons" }],
            ids: {},
            createdAt: "2025-02-01T00:00:00.000Z",
          }),
        },
      ];
      vi.mocked(records.listRecords).mockImplementation(async (_session, collection) => {
        if (collection === NSID.shelfEntry) return records_;
        return [];
      });
      vi.mocked(records.deleteRecord).mockResolvedValue();

      await attachSession(fakeSession);

      expect(records.deleteRecord).toHaveBeenCalledTimes(1);
      // Tiebreaker is recency, so the older r1 is the duplicate.
      expect(vi.mocked(records.deleteRecord).mock.calls[0][2]).toBe("r1");
    });

    it("leaves a single shelf entry untouched", async () => {
      vi.mocked(records.listRecords).mockImplementation(async (_session, collection) => {
        if (collection === NSID.shelfEntry) {
          return [
            {
              uri: "at://test/col/only",
              rkey: "only",
              value: makeShelfPdsRecord({ ids: { olWorkId: "OL1W" } }),
            },
          ];
        }
        return [];
      });

      await attachSession(fakeSession);

      expect(records.deleteRecord).not.toHaveBeenCalled();
    });

    it("dedupes duplicate author follows by olAuthorKey", async () => {
      const dup1: AuthorFollowRecord = {
        name: "Brandon Sanderson",
        olAuthorKey: "OL2700751A",
        createdAt: "2025-01-01T00:00:00.000Z",
      };
      const dup2: AuthorFollowRecord = {
        name: "Brandon Sanderson",
        olAuthorKey: "OL2700751A",
        imageUrl: "https://example.com/cover.jpg",
        createdAt: "2025-02-01T00:00:00.000Z",
      };
      vi.mocked(records.listRecords).mockImplementation(async (_session, collection) => {
        if (collection === NSID.authorFollow) {
          return [
            { uri: "at://test/col/a1", rkey: "a1", value: dup1 },
            { uri: "at://test/col/a2", rkey: "a2", value: dup2 },
          ];
        }
        return [];
      });
      vi.mocked(records.deleteRecord).mockResolvedValue();

      await attachSession(fakeSession);

      expect(records.deleteRecord).toHaveBeenCalledTimes(1);
      // The richer record (with imageUrl) survives.
      expect(vi.mocked(records.deleteRecord).mock.calls[0][2]).toBe("a1");
      const author = storage.getAuthors().find((a) => a.olKey === "OL2700751A");
      expect(author?.pdsRkey).toBe("a2");
    });

    it("dedupes duplicate dismissed entries by workId", async () => {
      const base = {
        ids: { olWorkId: "OL999W" },
        title: "Some Book",
        authors: [{ name: "Some Author" }],
      };
      vi.mocked(records.listRecords).mockImplementation(async (_session, collection) => {
        if (collection === NSID.bookDismissed) {
          return [
            {
              uri: "at://test/col/d1",
              rkey: "d1",
              value: { ...base, createdAt: "2025-01-01T00:00:00.000Z" },
            },
            {
              uri: "at://test/col/d2",
              rkey: "d2",
              value: { ...base, createdAt: "2025-02-01T00:00:00.000Z" },
            },
          ];
        }
        return [];
      });
      vi.mocked(records.deleteRecord).mockResolvedValue();

      await attachSession(fakeSession);

      expect(records.deleteRecord).toHaveBeenCalledTimes(1);
      // Newer one wins on the recency tiebreaker.
      expect(vi.mocked(records.deleteRecord).mock.calls[0][2]).toBe("d1");
    });
  });
});
