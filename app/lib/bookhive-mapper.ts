import type { Book } from "./storage";

/**
 * Shape of a `buzz.bookhive.book` record as returned by
 * `com.atproto.repo.listRecords`. We only model the fields we consume —
 * everything else is tolerated and ignored.
 *
 * Lexicon: https://github.com/nperez0111/bookhive/blob/main/lexicons/book.json
 */
export interface BookhiveBookRecord {
  $type?: string;
  title: string;
  authors: string;
  hiveId?: string;
  status?: "finished" | "reading" | "wantToRead" | "abandoned";
  createdAt?: string;
  identifiers?: {
    isbn?: string[];
    isbn13?: string[];
    [k: string]: unknown;
  };
  hiveBookUri?: string;
}

export interface BookhiveListEntry {
  uri: string;
  cid?: string;
  value: BookhiveBookRecord;
}

function rkeyFromAtUri(uri: string): string {
  const parts = uri.split("/");
  return parts[parts.length - 1] || uri;
}

function pickIsbn13(record: BookhiveBookRecord): string | undefined {
  const ids = record.identifiers;
  if (!ids) return undefined;
  const candidates = [
    ...(Array.isArray(ids.isbn13) ? ids.isbn13 : []),
    ...(Array.isArray(ids.isbn) ? ids.isbn : []),
  ];
  const thirteen = candidates.find(
    (v) => typeof v === "string" && v.replace(/\D/g, "").length === 13,
  );
  return thirteen?.replace(/\D/g, "");
}

function normalizeAuthors(authors: string): string {
  // Bookhive stores authors tab-separated; display as comma-separated.
  return authors
    .split("\t")
    .map((a) => a.trim())
    .filter(Boolean)
    .join(", ");
}

/**
 * Convert a list of `buzz.bookhive.book` records into shelfcheck Books,
 * keeping only entries whose status is `wantToRead`.
 */
export function bookhiveRecordsToBooks(entries: BookhiveListEntry[]): Book[] {
  const books: Book[] = [];
  for (const entry of entries) {
    const rec = entry.value;
    if (!rec || rec.status !== "wantToRead") continue;
    if (!rec.title) continue;

    const rkey = rkeyFromAtUri(entry.uri);
    books.push({
      id: `bh-${rkey}`,
      title: rec.title,
      author: normalizeAuthors(rec.authors ?? ""),
      isbn13: pickIsbn13(rec),
      source: "bookhive",
    });
  }
  return books;
}
