import type { Book } from "./storage";

/**
 * Shape of a `buzz.bookhive.book` record as returned by
 * `com.atproto.repo.listRecords`. We only model the fields we consume —
 * everything else is tolerated and ignored.
 *
 * Lexicon: https://github.com/nperez0111/bookhive/blob/main/lexicons/book.json
 */
/**
 * Status is stored as a lexicon reference string, e.g.
 * `"buzz.bookhive.defs#wantToRead"`. Older clients may write the bare
 * token — we normalize both forms.
 */

export interface BookhiveBookRecord {
  $type?: string;
  title: string;
  authors: string;
  hiveId?: string;
  status?: string;
  createdAt?: string;
  identifiers?: {
    isbn?: string[];
    isbn10?: string[];
    isbn13?: string[];
    [k: string]: unknown;
  };
  hiveBookUri?: string;
}

/** Returns just the token part of a status string (`"a.b.c#wantToRead"` -> `"wantToRead"`). */
function statusToken(status: string | undefined): string | undefined {
  if (!status) return undefined;
  const hash = status.lastIndexOf("#");
  return hash >= 0 ? status.slice(hash + 1) : status;
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

function toStringArray(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

function pickIsbn13(record: BookhiveBookRecord): string | undefined {
  const ids = record.identifiers;
  if (!ids) return undefined;
  const candidates = [...toStringArray(ids.isbn13), ...toStringArray(ids.isbn)];
  const thirteen = candidates.map((v) => v.replace(/\D/g, "")).find((v) => v.length === 13);
  return thirteen;
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
    if (!rec || statusToken(rec.status) !== "wantToRead") continue;
    if (!rec.title) continue;

    const rkey = rkeyFromAtUri(entry.uri);
    books.push({
      id: `bh-${rkey}`,
      title: rec.title,
      author: normalizeAuthors(rec.authors ?? ""),
      isbn13: pickIsbn13(rec),
      source: "bookhive",
      sourceUrl: rec.hiveId ? `https://bookhive.buzz/books/${rec.hiveId}` : undefined,
    });
  }
  return books;
}
