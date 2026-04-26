import { dedupeBooks } from "./dedupe";

const PREFIX = "shelfcheck:";

export interface LibraryConfig {
  key: string;
  preferredKey: string;
  name: string;
  logoUrl?: string;
}

export interface AuthorEntry {
  id: string;
  name: string;
  /** Open Library author key (e.g. "OL23919A"). */
  olKey?: string;
  imageUrl?: string;
  /** rkey of the corresponding org.shelfcheck.author.follow record, when synced to a PDS. */
  pdsRkey?: string;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  isbn13?: string;
  imageUrl?: string;
  source: "goodreads" | "hardcover" | "storygraph" | "bookhive" | "lyndi" | "unknown";
  sourceUrl?: string;
  manual?: boolean;
  /** Open Library Work ID (e.g. "OL45883W"); edition-independent. */
  workId?: string;
  /** Canonical title from Open Library, if different from the source title. */
  canonicalTitle?: string;
  /** Canonical author from Open Library, if different from the source author. */
  canonicalAuthor?: string;
  /** Subject tags / genres from Open Library. */
  subjects?: string[];
  /** Median page count from Open Library. */
  pageCount?: number;
  /** Year the work was first published. */
  firstPublishYear?: number;
  /** rkey of the corresponding org.shelfcheck.shelf.entry record, when synced to a PDS. */
  pdsRkey?: string;
}

function get<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function set(key: string, value: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Ignore quota errors
  }
}

function remove(key: string) {
  localStorage.removeItem(PREFIX + key);
}

// Migrate single library to array format
function migrateLibrary() {
  const raw = localStorage.getItem(PREFIX + "library");
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) && parsed.key) {
      set("libraries", [parsed]);
      remove("library");
    }
  } catch {
    // ignore
  }
}

export function getLibraries(): LibraryConfig[] {
  migrateLibrary();
  return get<LibraryConfig[]>("libraries") ?? [];
}

function setLibraries(configs: LibraryConfig[]) {
  set("libraries", configs);
}

export function addLibrary(config: LibraryConfig) {
  const libs = getLibraries();
  if (libs.some((l) => l.key === config.key)) return;
  libs.push(config);
  setLibraries(libs);
}

export function removeLibrary(key: string) {
  setLibraries(getLibraries().filter((l) => l.key !== key));
}

export function clearLibraries() {
  remove("libraries");
  remove("library"); // clean up old format
}

export function getBooks(): Book[] {
  return get<Book[]>("books") ?? [];
}

function writeBooks(books: Book[]) {
  set("books", books);
}

/**
 * Source priority for de-dup tie-breaking. Lower number = higher priority.
 * Bookhive wins because it's a live sync, so its `id` and metadata stay
 * stable when CSV imports add the same work under a different source.
 */
const SOURCE_PRIORITY: Record<Book["source"], number> = {
  bookhive: 0,
  goodreads: 1,
  hardcover: 1,
  storygraph: 1,
  unknown: 2,
  lyndi: 3,
};

/**
 * Compute the new book list when importing `imported` from `source`,
 * preserving books from other sources and (optionally) manual additions.
 * Pure / no I/O so it can be unit-tested directly.
 */
export function mergeImportForSource(
  existing: Book[],
  imported: Book[],
  source: Book["source"],
  opts: { clearManual?: boolean } = {},
): Book[] {
  const kept = existing.filter((b) => {
    if (b.manual) return !opts.clearManual;
    return b.source !== source;
  });

  // Sort by source priority so dedupe's first-wins semantics let higher-
  // priority sources keep their id and metadata. Sort is stable so books
  // within the same priority keep their relative order.
  const ordered = [...imported, ...kept].sort(
    (a, b) => (SOURCE_PRIORITY[a.source] ?? 99) - (SOURCE_PRIORITY[b.source] ?? 99),
  );

  return dedupeBooks(ordered);
}

/**
 * Replace the books from a single import source while preserving books from
 * other sources and (optionally) manual additions. After merge the combined
 * list is deduped by Open Library workId / fuzzy title+author key, with
 * Bookhive entries winning on collisions so live-sync metadata persists.
 */
export function setImportedBooks(
  imported: Book[],
  source: Book["source"],
  opts: { clearManual?: boolean } = {},
) {
  const previous = getBooks();
  const next = mergeImportForSource(previous, imported, source, opts);
  writeBooks(next);
  emitMutation({ kind: "books:bulkSet", previous, next });
}

/** Update a single book in storage by id, merging new fields. */
export function updateBook(id: string, updates: Partial<Book>) {
  const books = getBooks();
  const idx = books.findIndex((b) => b.id === id);
  if (idx === -1) return;
  const updated = { ...books[idx], ...updates };
  books[idx] = updated;
  writeBooks(books);
  emitMutation({ kind: "book:updated", book: updated });
}

export function addBook(book: Omit<Book, "id" | "manual">) {
  const books = getBooks();
  const id = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const newBook: Book = { ...book, id, manual: true };
  books.push(newBook);
  writeBooks(books);
  emitMutation({ kind: "book:added", book: newBook });
}

export function removeBook(id: string) {
  const books = getBooks();
  const removed = books.find((b) => b.id === id);
  if (!removed) return;
  writeBooks(books.filter((b) => b.id !== id));
  emitMutation({ kind: "book:removed", book: removed });
}

export function clearBooks() {
  const previous = getBooks();
  remove("books");
  emitMutation({ kind: "books:bulkSet", previous, next: [] });
}

export function getBookhiveLastSync(): string | null {
  return get<string>("bookhive-last-sync");
}

export function setBookhiveLastSync(iso: string) {
  set("bookhive-last-sync", iso);
}

export function clearBookhiveLastSync() {
  remove("bookhive-last-sync");
}

// --- Skipped Rows (persisted so they survive page navigations) ---

import type { SkippedRow } from "./csv-parser";

export function getSkippedRows(): SkippedRow[] {
  return get<SkippedRow[]>("skipped-rows") ?? [];
}

export function setSkippedRows(rows: SkippedRow[]) {
  set("skipped-rows", rows);
}

export function clearSkippedRows() {
  remove("skipped-rows");
}

// --- Read / Dismissed key helpers ---

function normalizeForKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Build a stable key for matching books across pages. Uses workId when available. */
export function readBookKey(opts: { workId?: string; title: string; author: string }): string {
  if (opts.workId) return `work:${opts.workId}`;
  return `fuzzy:${normalizeForKey(opts.title)}\0${normalizeForKey(opts.author)}`;
}

/** Build a stable key for author-page works. Uses olWorkKey when available. */
export function workDismissKey(opts: {
  olWorkKey?: string;
  title: string;
  author: string;
}): string {
  if (opts.olWorkKey) return `work:${opts.olWorkKey}`;
  return `fuzzy:${normalizeForKey(opts.title)}\0${normalizeForKey(opts.author)}`;
}

// --- Read Books ---

/** A book the user has marked as "read". Keyed by workId or fuzzy title+author. */
export interface ReadBookEntry {
  /** The key used for matching: "work:<workId>" or "fuzzy:<normalizedTitle>\0<normalizedAuthor>" */
  key: string;
  title: string;
  author: string;
  workId?: string;
  markedAt: number;
  /** rkey of the org.shelfcheck.shelf.entry record (status=finished) on the PDS, when synced. */
  pdsRkey?: string;
}

export function getReadBooks(): ReadBookEntry[] {
  return get<ReadBookEntry[]>("read-books") ?? [];
}

function writeReadBooks(entries: ReadBookEntry[]) {
  set("read-books", entries);
}

export function addReadBook(entry: Omit<ReadBookEntry, "markedAt">) {
  const books = getReadBooks();
  if (books.some((b) => b.key === entry.key)) return;
  const newEntry: ReadBookEntry = { ...entry, markedAt: Date.now() };
  books.push(newEntry);
  writeReadBooks(books);
  emitMutation({ kind: "read:added", entry: newEntry });
}

export function removeReadBook(key: string) {
  const books = getReadBooks();
  const removed = books.find((b) => b.key === key);
  if (!removed) return;
  writeReadBooks(books.filter((b) => b.key !== key));
  emitMutation({ kind: "read:removed", entry: removed });
}

// --- Dismissed Works (for author page) ---

/** A work dismissed from author suggestions. */
export interface DismissedWorkEntry {
  /** "work:<olWorkKey>" or "fuzzy:<normalizedTitle>\0<normalizedAuthor>" */
  key: string;
  dismissedAt: number;
  /** Title at time of dismissal (denormalized so we can publish a self-contained PDS record). */
  title?: string;
  /** Author at time of dismissal. */
  author?: string;
  /** Open Library Work ID, when known. */
  workId?: string;
  /** rkey of the org.shelfcheck.book.dismissed record on the PDS, when synced. */
  pdsRkey?: string;
}

export function getDismissedWorks(): DismissedWorkEntry[] {
  return get<DismissedWorkEntry[]>("dismissed-works") ?? [];
}

function writeDismissedWorks(entries: DismissedWorkEntry[]) {
  set("dismissed-works", entries);
}

/**
 * Add a dismissed work. We accept the full work info (not just the key) so
 * that synced PDS records carry enough metadata to be portable to other
 * clients — a bare key isn't.
 */
export function addDismissedWork(entry: {
  key: string;
  title?: string;
  author?: string;
  workId?: string;
}) {
  const works = getDismissedWorks();
  if (works.some((w) => w.key === entry.key)) return;
  const newEntry: DismissedWorkEntry = {
    key: entry.key,
    dismissedAt: Date.now(),
    title: entry.title,
    author: entry.author,
    workId: entry.workId,
  };
  works.push(newEntry);
  writeDismissedWorks(works);
  emitMutation({ kind: "dismissed:added", entry: newEntry });
}

// --- Authors ---

export function getAuthors(): AuthorEntry[] {
  return get<AuthorEntry[]>("authors") ?? [];
}

function writeAuthors(authors: AuthorEntry[]) {
  set("authors", authors);
}

export function addAuthor(author: Omit<AuthorEntry, "id">) {
  const authors = getAuthors();
  // Dedupe by name (case-insensitive)
  if (authors.some((a) => a.name.toLowerCase() === author.name.toLowerCase())) return;
  const id = `author-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const newAuthor: AuthorEntry = { ...author, id };
  authors.push(newAuthor);
  writeAuthors(authors);
  emitMutation({ kind: "author:added", author: newAuthor });
}

export function removeAuthor(id: string) {
  const authors = getAuthors();
  const removed = authors.find((a) => a.id === id);
  if (!removed) return;
  writeAuthors(authors.filter((a) => a.id !== id));
  emitMutation({ kind: "author:removed", author: removed });
}

export function clearAuthors() {
  const previous = getAuthors();
  remove("authors");
  for (const a of previous) emitMutation({ kind: "author:removed", author: a });
}

export function clearAll() {
  clearLibraries();
  clearBooks();
  clearSkippedRows();
  clearAuthors();
  clearBookhiveLastSync();
  remove("availability");
  remove("author-availability");
  // Emit removals for read + dismissed so any active sync engine can
  // propagate the deletion to the PDS.
  const reads = getReadBooks();
  remove("read-books");
  for (const r of reads) emitMutation({ kind: "read:removed", entry: r });
  const dismissals = getDismissedWorks();
  remove("dismissed-works");
  for (const d of dismissals) emitMutation({ kind: "dismissed:removed", entry: d });
}

// --- Mutation event bus (for the ATproto sync engine) ---
//
// Storage stays the single source of truth for the local cache and exposes a
// minimal event stream so that the optional ATproto sync layer can mirror
// changes to the user's PDS without storage knowing anything about ATproto.

export type StorageMutation =
  | { kind: "book:added"; book: Book }
  | { kind: "book:updated"; book: Book }
  | { kind: "book:removed"; book: Book }
  | { kind: "books:bulkSet"; previous: Book[]; next: Book[] }
  | { kind: "author:added"; author: AuthorEntry }
  | { kind: "author:removed"; author: AuthorEntry }
  | { kind: "read:added"; entry: ReadBookEntry }
  | { kind: "read:removed"; entry: ReadBookEntry }
  | { kind: "dismissed:added"; entry: DismissedWorkEntry }
  | { kind: "dismissed:removed"; entry: DismissedWorkEntry };

const mutationListeners = new Set<(m: StorageMutation) => void>();

export function onStorageMutation(fn: (m: StorageMutation) => void): () => void {
  mutationListeners.add(fn);
  return () => mutationListeners.delete(fn);
}

function emitMutation(m: StorageMutation) {
  for (const fn of mutationListeners) {
    try {
      fn(m);
    } catch (err) {
      console.error("[storage] mutation listener threw", err);
    }
  }
}

// --- Internal helpers used by the ATproto sync engine to write back rkeys
// and to bulk-replace state on hydrate. These mutate localStorage without
// emitting mutation events, so the sync engine can update local caches with
// PDS-derived data without re-triggering a push back to the PDS. ---

export function _setBookPdsRkey(id: string, rkey: string) {
  const books = getBooks();
  const idx = books.findIndex((b) => b.id === id);
  if (idx === -1) return;
  books[idx] = { ...books[idx], pdsRkey: rkey };
  writeBooks(books);
}

export function _setAuthorPdsRkey(id: string, rkey: string) {
  const authors = getAuthors();
  const idx = authors.findIndex((a) => a.id === id);
  if (idx === -1) return;
  authors[idx] = { ...authors[idx], pdsRkey: rkey };
  writeAuthors(authors);
}

export function _setReadPdsRkey(key: string, rkey: string) {
  const entries = getReadBooks();
  const idx = entries.findIndex((e) => e.key === key);
  if (idx === -1) return;
  entries[idx] = { ...entries[idx], pdsRkey: rkey };
  writeReadBooks(entries);
}

export function _setDismissedPdsRkey(key: string, rkey: string) {
  const entries = getDismissedWorks();
  const idx = entries.findIndex((e) => e.key === key);
  if (idx === -1) return;
  entries[idx] = { ...entries[idx], pdsRkey: rkey };
  writeDismissedWorks(entries);
}

/** Bulk-replace local books with PDS-sourced records. Does not emit events. */
export function _replaceBooksFromPds(books: Book[]) {
  writeBooks(dedupeBooks(books));
}

export function _replaceAuthorsFromPds(authors: AuthorEntry[]) {
  writeAuthors(authors);
}

export function _replaceReadBooksFromPds(entries: ReadBookEntry[]) {
  writeReadBooks(entries);
}

export function _replaceDismissedFromPds(entries: DismissedWorkEntry[]) {
  writeDismissedWorks(entries);
}
