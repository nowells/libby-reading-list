import type { Book, AuthorEntry, ShelfStatus } from "./storage";

/**
 * Normalize a CSV "status"/"shelf"/"read status" cell into our internal
 * ShelfStatus enum. Returns undefined for unknown / empty values so the
 * caller can decide whether to fall back (Goodreads / StoryGraph default
 * to want-to-read when no status is set).
 *
 * Recognized inputs cover the verbatim values exported by Goodreads
 * ("to-read" / "currently-reading" / "read"), Hardcover (free-text +
 * numeric 1..4), and StoryGraph ("to-read" / "currently-reading" /
 * "read" / "did-not-finish").
 */
function normalizeStatus(raw: string): ShelfStatus | undefined {
  const v = raw.trim().toLowerCase();
  if (!v) return undefined;
  if (v === "want to read" || v === "to-read" || v === "to read" || v === "1") {
    return "wantToRead";
  }
  if (v === "currently reading" || v === "currently-reading" || v === "reading" || v === "2") {
    return "reading";
  }
  if (v === "read" || v === "finished" || v === "3") {
    return "finished";
  }
  if (
    v === "did not finish" ||
    v === "did-not-finish" ||
    v === "dnf" ||
    v === "abandoned" ||
    v === "4"
  ) {
    return "abandoned";
  }
  return undefined;
}

/**
 * Convert a 0..5 star rating (possibly decimal, possibly empty) into our
 * 0..100 internal rating. Returns undefined for empty / NaN / out-of-range.
 */
function normalizeRating(raw: string): number | undefined {
  const v = raw.trim();
  if (!v) return undefined;
  const stars = Number(v);
  if (!Number.isFinite(stars) || stars <= 0 || stars > 5) return undefined;
  return Math.round(stars * 20);
}

/**
 * Best-effort conversion of common CSV date formats (YYYY/MM/DD,
 * YYYY-MM-DD, MM/DD/YYYY) to a stored ISO 8601 string. Empty / unparseable
 * inputs return undefined so the field stays absent on the Book.
 */
function normalizeDate(raw: string): string | undefined {
  const v = raw.trim();
  if (!v) return undefined;
  const ms = Date.parse(v.replace(/\//g, "-"));
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString();
}

interface ParsedCSV {
  headers: string[];
  rows: Record<string, string>[];
}

function parseRawRows(text: string): string[][] {
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

  return rows;
}

function parseCSV(text: string): ParsedCSV {
  const rows = parseRawRows(text);

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

/**
 * Flexible CSV parser that scans rows to find the header row.
 * Skips extraneous rows at the top (e.g. "Books to Read") until it finds a
 * row whose first two non-empty cells look like "title" and "author"
 * (case-insensitive). Everything after that row is treated as data.
 */
function parseCSVFlexible(text: string): ParsedCSV {
  const rows = parseRawRows(text);
  if (rows.length === 0) return { headers: [], rows: [] };

  // Find the header row: first row that contains both "title" and "author"
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const lower = new Set(rows[i].map((c) => c.trim().toLowerCase()));
    if (lower.has("title") && lower.has("author")) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) return { headers: [], rows: [] };

  const headers = rows[headerIdx].map((h) => h.trim());
  const dataRows = rows.slice(headerIdx + 1).map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = (row[i] ?? "").trim();
    });
    return obj;
  });

  return { headers, rows: dataRows };
}

type Format = "goodreads" | "hardcover" | "storygraph" | "lyndi" | "unknown";

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
    const title = findColumn(row, "Title");
    if (!title) continue;

    const status = normalizeStatus(findColumn(row, "Exclusive Shelf"));
    const author = findColumn(row, "Author", "Author l-f");
    const isbn13 = findColumn(row, "ISBN13").replace(/[="]/g, "");
    const bookId = findColumn(row, "Book Id");
    const rating = normalizeRating(findColumn(row, "My Rating", "Rating"));
    const note = findColumn(row, "My Review", "Review", "Private Notes") || undefined;
    const finishedAt = normalizeDate(findColumn(row, "Date Read"));
    const startedAt = normalizeDate(findColumn(row, "Date Started"));

    books.push({
      id: `gr-${id++}`,
      title,
      author,
      isbn13: isbn13 || undefined,
      source: "goodreads",
      sourceUrl: bookId ? `https://www.goodreads.com/book/show/${bookId}` : undefined,
      status,
      rating,
      note,
      startedAt,
      finishedAt,
    });
  }

  return books;
}

function parseHardcoverRows(rows: Record<string, string>[]): Book[] {
  const books: Book[] = [];
  let id = 0;

  for (const row of rows) {
    const title = findColumn(row, "Title");
    if (!title) continue;

    const status = normalizeStatus(findColumn(row, "Status", "Reading Status", "Shelf"));
    const author = findColumn(row, "Author", "Authors");
    const isbn13 = findColumn(row, "ISBN 13", "ISBN13", "isbn_13").replace(/[="]/g, "");
    const imageUrl = findColumn(row, "Image", "Image URL", "Cover");
    const slug = findColumn(row, "Slug", "Book Slug", "URL");
    const rating = normalizeRating(findColumn(row, "Rating", "My Rating", "Star Rating"));
    const note = findColumn(row, "Review", "Notes", "My Review") || undefined;
    const finishedAt = normalizeDate(findColumn(row, "Read Date", "Date Read", "Finished"));
    const startedAt = normalizeDate(findColumn(row, "Started", "Date Started"));

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
      status,
      rating,
      note,
      startedAt,
      finishedAt,
    });
  }

  return books;
}

function parseStorygraphRows(rows: Record<string, string>[]): Book[] {
  const books: Book[] = [];
  let id = 0;

  for (const row of rows) {
    const title = findColumn(row, "Title");
    if (!title) continue;

    const status = normalizeStatus(findColumn(row, "Read Status"));
    const authors = findColumn(row, "Authors", "Author");
    const rawIsbn = findColumn(row, "ISBN/UID", "ISBN13", "ISBN").replace(/\D/g, "");
    const isbn13 = rawIsbn.length === 13 ? rawIsbn : undefined;
    const rating = normalizeRating(findColumn(row, "Star Rating", "Rating"));
    const note = findColumn(row, "Review") || undefined;
    const finishedAt = normalizeDate(findColumn(row, "Last Date Read", "Date Read"));

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
      status,
      rating,
      note,
      finishedAt,
    });
  }

  return books;
}

/** A row that could not be imported as a book (missing title, etc.) */
export interface SkippedRow {
  /** The raw text that was available (author name, notes, etc.) */
  author: string;
  note: string;
}

/**
 * Parse a "Lyndi"-style CSV: flexible header detection, extracts both books
 * (rows with title + author) and standalone authors (rows with author only,
 * optionally with notes listing specific book recommendations).
 */
function parseLyndiRows(rows: Record<string, string>[]): {
  books: Book[];
  authors: AuthorEntry[];
  skipped: SkippedRow[];
} {
  const books: Book[] = [];
  const authors: AuthorEntry[] = [];
  const skipped: SkippedRow[] = [];
  let bookId = 0;

  for (const row of rows) {
    const title = findColumn(row, "Title");
    const author = findColumn(row, "Author", "Authors");

    if (!author) continue;

    if (title) {
      // Regular book row
      books.push({
        id: `ly-${bookId++}`,
        title,
        author,
        source: "lyndi",
      });
    } else {
      // Author-only row: check for notes with specific book recommendations
      const allValues = Object.values(row).filter((v) => v && v !== author);
      const noteText = allValues.join(" ");
      const match = noteText.match(/\(([^)]+)\)/);
      let extractedBooks = false;

      if (match) {
        const noteContent = match[1];
        // Check for multiple books separated by "&"
        const titles = noteContent.split(" & ").map((t) => t.trim());
        const hasBookTitles = titles.some(
          (t) => !t.toLowerCase().includes("was great") && t.length > 0,
        );

        if (hasBookTitles) {
          extractedBooks = true;
          // Extract individual books from the notes
          for (const t of titles) {
            if (t.toLowerCase().includes("was great") || !t) continue;
            books.push({
              id: `ly-${bookId++}`,
              title: t,
              author,
              source: "lyndi",
            });
          }
        }
      }

      // Always add as a followed author
      authors.push({
        id: `ly-author-${authors.length}`,
        name: author,
      });
    }
  }

  return { books, authors, skipped };
}

interface ImportResult {
  books: Book[];
  authors: AuthorEntry[];
  skipped: SkippedRow[];
  format: Format;
  totalRows: number;
  error?: string;
}

export function importBooks(fileContent: string): ImportResult {
  const { headers, rows } = parseCSV(fileContent);

  if (rows.length === 0) {
    // Try flexible parsing (Lyndi format) — scans for header row
    const flexible = parseCSVFlexible(fileContent);
    if (flexible.rows.length > 0) {
      const result = parseLyndiRows(flexible.rows);
      return { ...result, format: "lyndi", totalRows: flexible.rows.length };
    }
    return {
      books: [],
      authors: [],
      skipped: [],
      format: "unknown",
      totalRows: 0,
      error: "CSV file appears to be empty.",
    };
  }

  const format = detectFormat(headers);

  if (format === "goodreads") {
    const books = parseGoodreadsRows(rows);
    return { books, authors: [], skipped: [], format, totalRows: rows.length };
  }

  if (format === "hardcover") {
    const books = parseHardcoverRows(rows);
    return { books, authors: [], skipped: [], format, totalRows: rows.length };
  }

  if (format === "storygraph") {
    const books = parseStorygraphRows(rows);
    return { books, authors: [], skipped: [], format, totalRows: rows.length };
  }

  // Try flexible parsing: maybe the first row isn't the header
  const flexible = parseCSVFlexible(fileContent);
  if (flexible.rows.length > 0) {
    const flexLower = new Set(flexible.headers.map((h) => h.toLowerCase()));
    if (flexLower.has("title") && flexLower.has("author")) {
      const result = parseLyndiRows(flexible.rows);
      return { ...result, format: "lyndi", totalRows: flexible.rows.length };
    }
  }

  // Unknown format — try to extract books generically
  const hasTitle = headers.some((h) => h.toLowerCase() === "title");
  if (!hasTitle) {
    return {
      books: [],
      authors: [],
      skipped: [],
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

  return { books, authors: [], skipped: [], format, totalRows: rows.length };
}
