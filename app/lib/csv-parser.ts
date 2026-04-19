import type { Book } from "./storage";

interface ParsedCSV {
  headers: string[];
  rows: Record<string, string>[];
}

function parseCSV(text: string): ParsedCSV {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        current.push(field);
        field = "";
      } else if (ch === "\n" || (ch === "\r" && next === "\n")) {
        current.push(field);
        field = "";
        if (current.some((f) => f.length > 0)) {
          rows.push(current);
        }
        current = [];
        if (ch === "\r") i++;
      } else {
        field += ch;
      }
    }
  }

  // Last field/row
  current.push(field);
  if (current.some((f) => f.length > 0)) {
    rows.push(current);
  }

  if (rows.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = rows[0].map((h) => h.trim());
  const dataRows = rows.slice(1).map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = (row[i] ?? "").trim();
    });
    return obj;
  });

  return { headers, rows: dataRows };
}

type Format = "goodreads" | "hardcover" | "storygraph" | "unknown";

function detectFormat(headers: string[]): Format {
  const lower = new Set(headers.map((h) => h.toLowerCase()));
  if (lower.has("exclusive shelf") && lower.has("title")) {
    return "goodreads";
  }
  // StoryGraph exports use "Read Status" together with "Moods" or "ISBN/UID".
  if (lower.has("read status") && (lower.has("moods") || lower.has("isbn/uid"))) {
    return "storygraph";
  }
  // Hardcover exports use "Title" and "Status" (or "Reading Status")
  if (lower.has("title") && (lower.has("status") || lower.has("reading status"))) {
    return "hardcover";
  }
  return "unknown";
}

function findColumn(row: Record<string, string>, ...candidates: string[]): string {
  for (const c of candidates) {
    // Try exact match first
    if (c in row) return row[c];
    // Try case-insensitive
    const key = Object.keys(row).find((k) => k.toLowerCase() === c.toLowerCase());
    if (key) return row[key];
  }
  return "";
}

function parseGoodreadsRows(rows: Record<string, string>[]): Book[] {
  const books: Book[] = [];
  let id = 0;

  for (const row of rows) {
    const shelf = findColumn(row, "Exclusive Shelf");
    if (shelf !== "to-read") continue;

    const title = findColumn(row, "Title");
    if (!title) continue;

    const author = findColumn(row, "Author", "Author l-f");
    const isbn13 = findColumn(row, "ISBN13").replace(/[="]/g, "");
    const bookId = findColumn(row, "Book Id");

    books.push({
      id: `gr-${id++}`,
      title,
      author,
      isbn13: isbn13 || undefined,
      source: "goodreads",
      sourceUrl: bookId ? `https://www.goodreads.com/book/show/${bookId}` : undefined,
    });
  }

  return books;
}

function parseHardcoverRows(rows: Record<string, string>[]): Book[] {
  const books: Book[] = [];
  let id = 0;

  for (const row of rows) {
    const status = findColumn(row, "Status", "Reading Status", "Shelf").toLowerCase();
    if (status !== "want to read" && status !== "to-read" && status !== "1") continue;

    const title = findColumn(row, "Title");
    if (!title) continue;

    const author = findColumn(row, "Author", "Authors");
    const isbn13 = findColumn(row, "ISBN 13", "ISBN13", "isbn_13").replace(/[="]/g, "");
    const imageUrl = findColumn(row, "Image", "Image URL", "Cover");
    const slug = findColumn(row, "Slug", "Book Slug", "URL");

    books.push({
      id: `hc-${id++}`,
      title,
      author,
      isbn13: isbn13 || undefined,
      imageUrl: imageUrl || undefined,
      source: "hardcover",
      sourceUrl: slug
        ? slug.startsWith("http")
          ? slug
          : `https://hardcover.app/books/${slug}`
        : undefined,
    });
  }

  return books;
}

function parseStorygraphRows(rows: Record<string, string>[]): Book[] {
  const books: Book[] = [];
  let id = 0;

  for (const row of rows) {
    const status = findColumn(row, "Read Status").toLowerCase().trim();
    if (status !== "to-read" && status !== "to read") continue;

    const title = findColumn(row, "Title");
    if (!title) continue;

    const authors = findColumn(row, "Authors", "Author");
    const rawIsbn = findColumn(row, "ISBN/UID", "ISBN13", "ISBN").replace(/\D/g, "");
    const isbn13 = rawIsbn.length === 13 ? rawIsbn : undefined;

    // StoryGraph's export has no book id/slug, so link back to an in-app search.
    const query = `${title} ${authors}`.trim();
    const sourceUrl = query
      ? `https://app.thestorygraph.com/browse?search_term=${encodeURIComponent(query)}`
      : undefined;

    books.push({
      id: `sg-${id++}`,
      title,
      author: authors,
      isbn13,
      source: "storygraph",
      sourceUrl,
    });
  }

  return books;
}

interface ImportResult {
  books: Book[];
  format: Format;
  totalRows: number;
  error?: string;
}

export function importBooks(fileContent: string): ImportResult {
  const { headers, rows } = parseCSV(fileContent);

  if (rows.length === 0) {
    return { books: [], format: "unknown", totalRows: 0, error: "CSV file appears to be empty." };
  }

  const format = detectFormat(headers);

  if (format === "goodreads") {
    const books = parseGoodreadsRows(rows);
    return { books, format, totalRows: rows.length };
  }

  if (format === "hardcover") {
    const books = parseHardcoverRows(rows);
    return { books, format, totalRows: rows.length };
  }

  if (format === "storygraph") {
    const books = parseStorygraphRows(rows);
    return { books, format, totalRows: rows.length };
  }

  // Unknown format — try to extract books generically
  const hasTitle = headers.some((h) => h.toLowerCase() === "title");
  if (!hasTitle) {
    return {
      books: [],
      format: "unknown",
      totalRows: rows.length,
      error: `Unrecognized CSV format. Expected a Goodreads or Hardcover export. Found columns: ${headers.slice(0, 5).join(", ")}${headers.length > 5 ? "..." : ""}`,
    };
  }

  // Generic fallback: import all rows with a title
  const books: Book[] = [];
  let id = 0;
  for (const row of rows) {
    const title = findColumn(row, "Title");
    if (!title) continue;
    const author = findColumn(row, "Author", "Authors");
    books.push({
      id: `csv-${id++}`,
      title,
      author,
      source: "unknown",
    });
  }

  return { books, format, totalRows: rows.length };
}
