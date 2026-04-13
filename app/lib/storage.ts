const PREFIX = "hardcoverlibby:";

export interface LibraryConfig {
  key: string;
  preferredKey: string;
  name: string;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  isbn13?: string;
  imageUrl?: string;
  source: "goodreads" | "hardcover" | "unknown";
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

export function getLibrary(): LibraryConfig | null {
  return get<LibraryConfig>("library");
}

export function setLibrary(config: LibraryConfig) {
  set("library", config);
}

export function clearLibrary() {
  remove("library");
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
  clearLibrary();
  clearBooks();
  remove("availability");
}
