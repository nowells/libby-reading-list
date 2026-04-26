import { describe, it, expect, vi } from "vitest";
import {
  mergeImportForSource,
  getLibraries,
  addLibrary,
  removeLibrary,
  clearLibraries,
  getBooks,
  addBook,
  removeBook,
  clearBooks,
  updateBook,
  setImportedBooks,
  getBookhiveLastSync,
  setBookhiveLastSync,
  clearBookhiveLastSync,
  getSkippedRows,
  setSkippedRows,
  clearSkippedRows,
  readBookKey,
  workDismissKey,
  getReadBooks,
  addReadBook,
  removeReadBook,
  getDismissedWorks,
  addDismissedWork,
  getAuthors,
  addAuthor,
  removeAuthor,
  clearAuthors,
  clearAll,
  onStorageMutation,
  _setBookPdsRkey,
  _setAuthorPdsRkey,
  _setReadPdsRkey,
  _setDismissedPdsRkey,
  _replaceBooksFromPds,
  _replaceAuthorsFromPds,
  _replaceDismissedFromPds,
  type Book,
  type LibraryConfig,
} from "./storage";

function book(overrides: Partial<Book> = {}): Book {
  return {
    id: "b",
    title: "Test",
    author: "Author",
    source: "unknown",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// mergeImportForSource (existing tests)
// ---------------------------------------------------------------------------
describe("mergeImportForSource", () => {
  it("re-importing one source replaces only that source's books", () => {
    const existing: Book[] = [
      book({ id: "gr-1", source: "goodreads", title: "Old A" }),
      book({ id: "gr-2", source: "goodreads", title: "Old B" }),
      book({ id: "bh-1", source: "bookhive", title: "Bookhive Book" }),
    ];
    const imported: Book[] = [book({ id: "gr-3", source: "goodreads", title: "New C" })];

    const result = mergeImportForSource(existing, imported, "goodreads");

    expect(result.map((b) => b.id).sort()).toEqual(["bh-1", "gr-3"]);
  });

  it("Bookhive entries take precedence over CSV entries for the same work", () => {
    const existing: Book[] = [
      book({
        id: "bh-1",
        source: "bookhive",
        title: "Foundation",
        author: "Asimov",
        workId: "OL1W",
        sourceUrl: "https://bookhive.buzz/books/bk_1",
      }),
    ];
    const imported: Book[] = [
      book({
        id: "gr-9",
        source: "goodreads",
        title: "Foundation",
        author: "Asimov",
        workId: "OL1W",
        isbn13: "9780553293357",
      }),
    ];

    const result = mergeImportForSource(existing, imported, "goodreads");

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("bh-1");
    expect(result[0].source).toBe("bookhive");
    expect(result[0].isbn13).toBe("9780553293357");
    expect(result[0].sourceUrl).toBe("https://bookhive.buzz/books/bk_1");
  });

  it("preserves manual books by default and clears them when requested", () => {
    const existing: Book[] = [
      book({ id: "manual-1", source: "unknown", manual: true, title: "Manual A" }),
      book({ id: "gr-1", source: "goodreads", title: "Old" }),
    ];
    const imported: Book[] = [book({ id: "gr-2", source: "goodreads", title: "New" })];

    const kept = mergeImportForSource(existing, imported, "goodreads");
    expect(kept.map((b) => b.id).sort()).toEqual(["gr-2", "manual-1"]);

    const cleared = mergeImportForSource(existing, imported, "goodreads", { clearManual: true });
    expect(cleared.map((b) => b.id)).toEqual(["gr-2"]);
  });

  it("re-importing Bookhive replaces only Bookhive entries", () => {
    const existing: Book[] = [
      book({ id: "bh-1", source: "bookhive", title: "Stale Bookhive" }),
      book({ id: "gr-1", source: "goodreads", title: "Goodreads Kept" }),
      book({ id: "sg-1", source: "storygraph", title: "StoryGraph Kept" }),
    ];
    const imported: Book[] = [book({ id: "bh-2", source: "bookhive", title: "Fresh Bookhive" })];

    const result = mergeImportForSource(existing, imported, "bookhive");

    expect(result.map((b) => b.id).sort()).toEqual(["bh-2", "gr-1", "sg-1"]);
  });

  it("preserves manual flag when a manual book matches an imported one", () => {
    const existing: Book[] = [
      book({
        id: "manual-1",
        source: "unknown",
        manual: true,
        title: "Foundation",
        author: "Asimov",
      }),
    ];
    const imported: Book[] = [
      book({ id: "gr-1", source: "goodreads", title: "Foundation", author: "Asimov" }),
    ];

    const result = mergeImportForSource(existing, imported, "goodreads");

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("gr-1");
    expect(result[0].manual).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Libraries
// ---------------------------------------------------------------------------
describe("Libraries", () => {
  it("returns empty array when no libraries stored", () => {
    expect(getLibraries()).toEqual([]);
  });

  it("adds and retrieves a library", () => {
    const lib: LibraryConfig = { key: "lapl", preferredKey: "lapl", name: "LAPL" };
    addLibrary(lib);
    const libs = getLibraries();
    expect(libs).toHaveLength(1);
    expect(libs[0].key).toBe("lapl");
  });

  it("deduplicates by key on add", () => {
    const lib: LibraryConfig = { key: "lapl", preferredKey: "lapl", name: "LAPL" };
    addLibrary(lib);
    addLibrary(lib);
    expect(getLibraries()).toHaveLength(1);
  });

  it("removes a library by key", () => {
    addLibrary({ key: "lapl", preferredKey: "lapl", name: "LAPL" });
    addLibrary({ key: "nypl", preferredKey: "nypl", name: "NYPL" });
    removeLibrary("lapl");
    const libs = getLibraries();
    expect(libs).toHaveLength(1);
    expect(libs[0].key).toBe("nypl");
  });

  it("clears all libraries", () => {
    addLibrary({ key: "lapl", preferredKey: "lapl", name: "LAPL" });
    clearLibraries();
    expect(getLibraries()).toEqual([]);
  });

  it("migrates old single-library format to array", () => {
    localStorage.setItem(
      "shelfcheck:library",
      JSON.stringify({ key: "old-lib", preferredKey: "old-lib", name: "Old Library" }),
    );
    const libs = getLibraries();
    expect(libs).toHaveLength(1);
    expect(libs[0].key).toBe("old-lib");
    expect(localStorage.getItem("shelfcheck:library")).toBeNull();
  });

  it("does not migrate if old library is already an array", () => {
    localStorage.setItem(
      "shelfcheck:library",
      JSON.stringify([{ key: "arr", preferredKey: "arr", name: "Array" }]),
    );
    const libs = getLibraries();
    expect(libs).toEqual([]);
  });

  it("handles corrupted library data gracefully", () => {
    localStorage.setItem("shelfcheck:library", "not-json");
    expect(getLibraries()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Books CRUD
// ---------------------------------------------------------------------------
describe("Books", () => {
  it("returns empty array when no books stored", () => {
    expect(getBooks()).toEqual([]);
  });

  it("adds a manual book with generated id", () => {
    addBook({ title: "Test Book", author: "Test Author", source: "unknown" });
    const books = getBooks();
    expect(books).toHaveLength(1);
    expect(books[0].id).toMatch(/^manual-/);
    expect(books[0].manual).toBe(true);
    expect(books[0].title).toBe("Test Book");
  });

  it("generates unique ids for multiple manual books", () => {
    addBook({ title: "Book A", author: "Author A", source: "unknown" });
    addBook({ title: "Book B", author: "Author B", source: "unknown" });
    const books = getBooks();
    expect(books[0].id).not.toBe(books[1].id);
  });

  it("removes a book by id", () => {
    addBook({ title: "Book A", author: "Author A", source: "unknown" });
    const books = getBooks();
    removeBook(books[0].id);
    expect(getBooks()).toHaveLength(0);
  });

  it("clears all books", () => {
    addBook({ title: "Book A", author: "Author A", source: "unknown" });
    clearBooks();
    expect(getBooks()).toEqual([]);
  });

  it("updates a book by id, merging fields", () => {
    addBook({ title: "Old Title", author: "Author", source: "unknown" });
    const id = getBooks()[0].id;
    updateBook(id, { title: "New Title", isbn13: "9780000000001" });
    const updated = getBooks()[0];
    expect(updated.title).toBe("New Title");
    expect(updated.isbn13).toBe("9780000000001");
    expect(updated.author).toBe("Author");
  });

  it("updateBook is a no-op for unknown id", () => {
    addBook({ title: "Book", author: "Author", source: "unknown" });
    updateBook("nonexistent", { title: "Changed" });
    expect(getBooks()[0].title).toBe("Book");
  });

  it("setImportedBooks replaces source and persists", () => {
    setImportedBooks([book({ id: "gr-1", source: "goodreads", title: "Book A" })], "goodreads");
    expect(getBooks()).toHaveLength(1);
    expect(getBooks()[0].title).toBe("Book A");

    setImportedBooks([book({ id: "gr-2", source: "goodreads", title: "Book B" })], "goodreads");
    expect(getBooks()).toHaveLength(1);
    expect(getBooks()[0].title).toBe("Book B");
  });
});

// ---------------------------------------------------------------------------
// Bookhive Last Sync
// ---------------------------------------------------------------------------
describe("Bookhive Last Sync", () => {
  it("returns null when no sync stored", () => {
    expect(getBookhiveLastSync()).toBeNull();
  });

  it("stores and retrieves sync timestamp", () => {
    const iso = "2026-01-01T00:00:00.000Z";
    setBookhiveLastSync(iso);
    expect(getBookhiveLastSync()).toBe(iso);
  });

  it("clears sync timestamp", () => {
    setBookhiveLastSync("2026-01-01T00:00:00.000Z");
    clearBookhiveLastSync();
    expect(getBookhiveLastSync()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Skipped Rows
// ---------------------------------------------------------------------------
describe("Skipped Rows", () => {
  it("returns empty array when no skipped rows", () => {
    expect(getSkippedRows()).toEqual([]);
  });

  it("stores and retrieves skipped rows", () => {
    const rows = [{ author: "Author A", note: "missing title" }];
    setSkippedRows(rows);
    expect(getSkippedRows()).toEqual(rows);
  });

  it("clears skipped rows", () => {
    setSkippedRows([{ author: "A", note: "n" }]);
    clearSkippedRows();
    expect(getSkippedRows()).toEqual([]);
  });

  it("overwrites previous skipped rows", () => {
    setSkippedRows([{ author: "A", note: "1" }]);
    setSkippedRows([{ author: "B", note: "2" }]);
    const rows = getSkippedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].author).toBe("B");
  });
});

// ---------------------------------------------------------------------------
// readBookKey / workDismissKey
// ---------------------------------------------------------------------------
describe("readBookKey", () => {
  it("uses workId when available", () => {
    expect(readBookKey({ workId: "OL123W", title: "T", author: "A" })).toBe("work:OL123W");
  });

  it("falls back to fuzzy key without workId", () => {
    const key = readBookKey({ title: "Test Book", author: "John Doe" });
    expect(key).toBe("fuzzy:testbook\0johndoe");
  });

  it("normalizes casing and punctuation", () => {
    const k1 = readBookKey({ title: "The Great Gatsby!", author: "F. Scott Fitzgerald" });
    const k2 = readBookKey({ title: "the great gatsby", author: "f scott fitzgerald" });
    expect(k1).toBe(k2);
  });
});

describe("workDismissKey", () => {
  it("uses olWorkKey when available", () => {
    expect(workDismissKey({ olWorkKey: "OL456W", title: "T", author: "A" })).toBe("work:OL456W");
  });

  it("falls back to fuzzy key without olWorkKey", () => {
    const key = workDismissKey({ title: "Book", author: "Author" });
    expect(key).toBe("fuzzy:book\0author");
  });
});

// ---------------------------------------------------------------------------
// Read Books
// ---------------------------------------------------------------------------
describe("Read Books", () => {
  it("returns empty array when none stored", () => {
    expect(getReadBooks()).toEqual([]);
  });

  it("adds a read book with timestamp", () => {
    addReadBook({ key: "work:OL1W", title: "Book", author: "Author" });
    const books = getReadBooks();
    expect(books).toHaveLength(1);
    expect(books[0].key).toBe("work:OL1W");
    expect(books[0].markedAt).toBeGreaterThan(0);
  });

  it("deduplicates by key", () => {
    addReadBook({ key: "work:OL1W", title: "Book", author: "Author" });
    addReadBook({ key: "work:OL1W", title: "Book", author: "Author" });
    expect(getReadBooks()).toHaveLength(1);
  });

  it("removes a read book by key", () => {
    addReadBook({ key: "work:OL1W", title: "Book", author: "Author" });
    removeReadBook("work:OL1W");
    expect(getReadBooks()).toHaveLength(0);
  });

  it("removeReadBook is safe for non-existent key", () => {
    removeReadBook("nonexistent");
    expect(getReadBooks()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Dismissed Works
// ---------------------------------------------------------------------------
describe("Dismissed Works", () => {
  it("returns empty array when none stored", () => {
    expect(getDismissedWorks()).toEqual([]);
  });

  it("adds a dismissed work with timestamp", () => {
    addDismissedWork({ key: "work:OL1W", title: "Book", author: "Author", workId: "OL1W" });
    const works = getDismissedWorks();
    expect(works).toHaveLength(1);
    expect(works[0].key).toBe("work:OL1W");
    expect(works[0].title).toBe("Book");
    expect(works[0].author).toBe("Author");
    expect(works[0].workId).toBe("OL1W");
    expect(works[0].dismissedAt).toBeGreaterThan(0);
  });

  it("deduplicates by key", () => {
    addDismissedWork({ key: "work:OL1W" });
    addDismissedWork({ key: "work:OL1W" });
    expect(getDismissedWorks()).toHaveLength(1);
  });

  it("stores multiple different keys", () => {
    addDismissedWork({ key: "work:OL1W" });
    addDismissedWork({ key: "work:OL2W" });
    expect(getDismissedWorks()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Authors
// ---------------------------------------------------------------------------
describe("Authors", () => {
  it("returns empty array when none stored", () => {
    expect(getAuthors()).toEqual([]);
  });

  it("adds an author with generated id", () => {
    addAuthor({ name: "Adrian Tchaikovsky" });
    const authors = getAuthors();
    expect(authors).toHaveLength(1);
    expect(authors[0].id).toMatch(/^author-/);
    expect(authors[0].name).toBe("Adrian Tchaikovsky");
  });

  it("deduplicates by name case-insensitively", () => {
    addAuthor({ name: "Adrian Tchaikovsky" });
    addAuthor({ name: "adrian tchaikovsky" });
    addAuthor({ name: "ADRIAN TCHAIKOVSKY" });
    expect(getAuthors()).toHaveLength(1);
  });

  it("stores optional fields", () => {
    addAuthor({ name: "Author", olKey: "OL123A", imageUrl: "https://example.com/photo.jpg" });
    const author = getAuthors()[0];
    expect(author.olKey).toBe("OL123A");
    expect(author.imageUrl).toBe("https://example.com/photo.jpg");
  });

  it("removes author by id", () => {
    addAuthor({ name: "Author A" });
    addAuthor({ name: "Author B" });
    const id = getAuthors()[0].id;
    removeAuthor(id);
    expect(getAuthors()).toHaveLength(1);
  });

  it("clears all authors", () => {
    addAuthor({ name: "Author" });
    clearAuthors();
    expect(getAuthors()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// clearAll
// ---------------------------------------------------------------------------
describe("clearAll", () => {
  it("clears all stored data", () => {
    addLibrary({ key: "lapl", preferredKey: "lapl", name: "LAPL" });
    addBook({ title: "Book", author: "Author", source: "unknown" });
    addAuthor({ name: "Author" });
    setBookhiveLastSync("2026-01-01T00:00:00.000Z");
    setSkippedRows([{ author: "A", note: "n" }]);
    addReadBook({ key: "work:OL1W", title: "B", author: "A" });
    addDismissedWork({ key: "work:OL2W" });

    clearAll();

    expect(getLibraries()).toEqual([]);
    expect(getBooks()).toEqual([]);
    expect(getAuthors()).toEqual([]);
    expect(getBookhiveLastSync()).toBeNull();
    expect(getSkippedRows()).toEqual([]);
    expect(getReadBooks()).toEqual([]);
    expect(getDismissedWorks()).toEqual([]);
  });

  it("is safe on empty storage", () => {
    clearAll();
    expect(getLibraries()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Corrupted localStorage
// ---------------------------------------------------------------------------
describe("corrupted localStorage", () => {
  it("returns defaults for corrupted books", () => {
    localStorage.setItem("shelfcheck:books", "not-json");
    expect(getBooks()).toEqual([]);
  });

  it("returns defaults for corrupted libraries", () => {
    localStorage.setItem("shelfcheck:libraries", "not-json");
    expect(getLibraries()).toEqual([]);
  });

  it("returns defaults for corrupted authors", () => {
    localStorage.setItem("shelfcheck:authors", "not-json");
    expect(getAuthors()).toEqual([]);
  });

  it("returns defaults for corrupted read-books", () => {
    localStorage.setItem("shelfcheck:read-books", "not-json");
    expect(getReadBooks()).toEqual([]);
  });

  it("returns defaults for corrupted dismissed-works", () => {
    localStorage.setItem("shelfcheck:dismissed-works", "not-json");
    expect(getDismissedWorks()).toEqual([]);
  });

  it("returns defaults for corrupted skipped-rows", () => {
    localStorage.setItem("shelfcheck:skipped-rows", "not-json");
    expect(getSkippedRows()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// onStorageMutation
// ---------------------------------------------------------------------------
describe("onStorageMutation", () => {
  it("notifies listeners when a book is added", () => {
    clearAll();
    const listener = vi.fn();
    const unsub = onStorageMutation(listener);
    addBook(book({ id: "mut1" }));
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ kind: "book:added" }));
    unsub();
  });

  it("unsubscribes correctly", () => {
    clearAll();
    const listener = vi.fn();
    const unsub = onStorageMutation(listener);
    unsub();
    addBook(book({ id: "mut2" }));
    expect(listener).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PDS rkey helpers
// ---------------------------------------------------------------------------
describe("PDS rkey helpers", () => {
  it("_setBookPdsRkey sets rkey on an existing book", () => {
    clearAll();
    addBook(book());
    const id = getBooks()[0].id;
    _setBookPdsRkey(id, "rk_abc");
    expect(getBooks()[0].pdsRkey).toBe("rk_abc");
  });

  it("_setBookPdsRkey is a no-op for missing book", () => {
    clearAll();
    _setBookPdsRkey("missing", "rk_abc");
    expect(getBooks()).toEqual([]);
  });

  it("_setAuthorPdsRkey sets rkey on an existing author", () => {
    clearAll();
    addAuthor({ name: "Test Author" });
    const author = getAuthors()[0];
    _setAuthorPdsRkey(author.id, "rk_auth");
    expect(getAuthors()[0].pdsRkey).toBe("rk_auth");
  });

  it("_setAuthorPdsRkey is a no-op for missing author", () => {
    clearAll();
    _setAuthorPdsRkey("missing", "rk_auth");
    expect(getAuthors()).toEqual([]);
  });

  it("_setReadPdsRkey sets rkey on a read book entry", () => {
    clearAll();
    addReadBook({ workId: "OL1W", title: "Test", author: "Auth" });
    const entry = getReadBooks()[0];
    _setReadPdsRkey(entry.key, "rk_read");
    expect(getReadBooks()[0].pdsRkey).toBe("rk_read");
  });

  it("_setReadPdsRkey is a no-op for missing entry", () => {
    clearAll();
    _setReadPdsRkey("missing", "rk_read");
    expect(getReadBooks()).toEqual([]);
  });

  it("_setDismissedPdsRkey sets rkey on a dismissed entry", () => {
    clearAll();
    addDismissedWork({ workId: "OL1W" });
    const entry = getDismissedWorks()[0];
    _setDismissedPdsRkey(entry.key, "rk_dis");
    expect(getDismissedWorks()[0].pdsRkey).toBe("rk_dis");
  });

  it("_setDismissedPdsRkey is a no-op for missing entry", () => {
    clearAll();
    _setDismissedPdsRkey("missing", "rk_dis");
    expect(getDismissedWorks()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// PDS bulk-replace helpers
// ---------------------------------------------------------------------------
describe("PDS bulk-replace helpers", () => {
  it("_replaceBooksFromPds overwrites local books", () => {
    clearAll();
    addBook(book({ id: "local1" }));
    _replaceBooksFromPds([book({ id: "pds1", title: "PDS Book" })]);
    const books = getBooks();
    expect(books).toHaveLength(1);
    expect(books[0].id).toBe("pds1");
  });

  it("_replaceAuthorsFromPds overwrites local authors", () => {
    clearAll();
    addAuthor({ name: "Local Author" });
    _replaceAuthorsFromPds([{ id: "a1", name: "PDS Author" }]);
    const authors = getAuthors();
    expect(authors).toHaveLength(1);
    expect(authors[0].name).toBe("PDS Author");
  });

  it("_replaceDismissedFromPds overwrites local dismissed works", () => {
    clearAll();
    addDismissedWork({ workId: "OL1W" });
    _replaceDismissedFromPds([{ key: "k1", workId: "OL2W" }]);
    const dismissed = getDismissedWorks();
    expect(dismissed).toHaveLength(1);
    expect(dismissed[0].workId).toBe("OL2W");
  });
});
