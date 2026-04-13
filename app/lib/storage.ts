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
  source: "goodreads" | "hardcover" | "unknown";
  sourceUrl?: string;
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

export function setBooks(books: Book[]) {
  set("books", books);
}

export function clearBooks() {
  remove("books");
}

export function clearAll() {
  clearLibraries();
  clearBooks();
  remove("availability");
}
