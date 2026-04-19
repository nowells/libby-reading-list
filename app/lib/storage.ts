import { dedupeBooks } from "./dedupe";

const PREFIX = "shelfcheck:";

export interface LibraryConfig {
  key: string;
  preferredKey: string;
  name: string;
  logoUrl?: string;
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
 * Replace imported books while preserving manually-added ones. Deduplicates
 * the combined list by Open Library workId (when present) or a normalized
 * title+author fuzzy key, so re-imports + manual adds don't accumulate
 * duplicates.
 */
export function setImportedBooks(imported: Book[], clearManual = false) {
  if (clearManual) {
    set("books", dedupeBooks(imported));
    return;
  }
  const manual = getBooks().filter((b) => b.manual);
  // Imported entries listed first so their id wins on merge, keeping
  // availability-cache hits stable across re-imports.
  set("books", dedupeBooks([...imported, ...manual]));
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

export function clearAll() {
  clearLibraries();
  clearBooks();
  clearBookhiveLastSync();
  remove("availability");
}
