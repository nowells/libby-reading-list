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
}

export interface Book {
  id: string;
  title: string;
  author: string;
  isbn13?: string;
  imageUrl?: string;
  source: "goodreads" | "hardcover" | "storygraph" | "bookhive" | "unknown";
  sourceUrl?: string;
  manual?: boolean;
  /** Open Library Work ID (e.g. "OL45883W"); edition-independent. */
  workId?: string;
  /** Canonical title from Open Library, if different from the source title. */
  canonicalTitle?: string;
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

function setBooks(books: Book[]) {
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
  set("books", mergeImportForSource(getBooks(), imported, source, opts));
}

export function addBook(book: Omit<Book, "id" | "manual">) {
  const books = getBooks();
  const id = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  books.push({ ...book, id, manual: true });
  set("books", books);
}

export function removeBook(id: string) {
  set(
    "books",
    getBooks().filter((b) => b.id !== id),
  );
}

export function clearBooks() {
  remove("books");
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

// --- Authors ---

export function getAuthors(): AuthorEntry[] {
  return get<AuthorEntry[]>("authors") ?? [];
}

export function setAuthors(authors: AuthorEntry[]) {
  set("authors", authors);
}

export function addAuthor(author: Omit<AuthorEntry, "id">) {
  const authors = getAuthors();
  // Dedupe by name (case-insensitive)
  if (authors.some((a) => a.name.toLowerCase() === author.name.toLowerCase())) return;
  const id = `author-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  authors.push({ ...author, id });
  set("authors", authors);
}

export function removeAuthor(id: string) {
  set(
    "authors",
    getAuthors().filter((a) => a.id !== id),
  );
}

export function clearAuthors() {
  remove("authors");
}

export function clearAll() {
  clearLibraries();
  clearBooks();
  clearAuthors();
  clearBookhiveLastSync();
  remove("availability");
  remove("author-availability");
}
