import type { Book } from "./storage";

/** Lowercase and strip all non-alphanumeric characters. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Build a "same work" key. When both books have an Open Library `workId`
 * this is the most accurate equivalence; otherwise we fall back to a
 * normalized title+author hash which collapses punctuation/case variants
 * like "F. Scott Fitzgerald" vs "F Scott Fitzgerald".
 */
export function bookKey(book: Book): string {
  if (book.workId) return `work:${book.workId}`;
  return `fuzzy:${normalize(book.title)}\0${normalize(book.author)}`;
}

/** Merge two Book records that refer to the same work. First-wins on id. */
export function mergeBooks(primary: Book, secondary: Book): Book {
  return {
    ...primary,
    isbn13: primary.isbn13 ?? secondary.isbn13,
    imageUrl: primary.imageUrl ?? secondary.imageUrl,
    sourceUrl: primary.sourceUrl ?? secondary.sourceUrl,
    workId: primary.workId ?? secondary.workId,
    canonicalTitle: primary.canonicalTitle ?? secondary.canonicalTitle,
    canonicalAuthor: primary.canonicalAuthor ?? secondary.canonicalAuthor,
    // Preserve manual: if either is manual, the merged record is manual so
    // it doesn't get wiped by a future CSV/Bookhive import.
    manual: primary.manual || secondary.manual ? true : undefined,
  };
}

/**
 * Deduplicate a list of books, collapsing entries that appear to refer to
 * the same work (via `workId` when available, else a fuzzy title+author
 * match). The first occurrence wins on id + source so availability-cache
 * lookups stay stable across re-imports.
 */
export function dedupeBooks(books: Book[]): Book[] {
  const byKey = new Map<string, Book>();
  for (const book of books) {
    const key = bookKey(book);
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeBooks(existing, book) : book);
  }
  return [...byKey.values()];
}
