import type { Book, AuthorEntry, ReadBookEntry, DismissedWorkEntry } from "../storage";
import {
  STATUS,
  type AuthorFollowRecord,
  type AuthorRef,
  type BookDismissedRecord,
  type BookIds,
  type ShelfEntryRecord,
  type ShelfStatusToken,
  statusTokenName,
} from "./lexicon";

const KNOWN_SOURCES = new Set([
  "goodreads",
  "hardcover",
  "storygraph",
  "bookhive",
  "popfeed",
  "lyndi",
  "manual",
  "unknown",
]);

function bookIdsForBook(book: Book): BookIds {
  const ids: BookIds = {};
  if (book.workId) ids.olWorkId = book.workId;
  if (book.isbn13) ids.isbn13 = book.isbn13;
  return ids;
}

function authorsForBook(book: Book): AuthorRef[] {
  // Source title strings often pack multiple authors as "A, B, C". We split
  // and emit one ref per name; the canonical author name (if Open Library
  // resolved one) is preferred so we can later match against author records.
  const raw = book.canonicalAuthor ?? book.author ?? "";
  const split = raw
    .split(/,\s*|\s+&\s+|\s+and\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const names = split.length > 0 ? split : ["Unknown"];
  return names.map((name) => ({ name }));
}

function sourceOrUndefined(source: Book["source"]): string | undefined {
  return KNOWN_SOURCES.has(source) ? source : undefined;
}

/**
 * Convert a local Book into a ShelfEntryRecord. The book's `status` field
 * (when set) takes priority over the explicit status argument so a book
 * already marked as `finished` doesn't get pushed up as `wantToRead` during
 * a generic reconcile sweep.
 */
export function bookToShelfRecord(
  book: Book,
  status: ShelfStatusToken,
  now: Date = new Date(),
): ShelfEntryRecord {
  const effectiveStatus = bookStatusToToken(book.status) ?? status;
  return {
    status: effectiveStatus,
    title: book.canonicalTitle ?? book.title,
    authors: authorsForBook(book),
    ids: bookIdsForBook(book),
    source: sourceOrUndefined(book.source),
    sourceUrl: book.sourceUrl,
    coverUrl: book.imageUrl,
    subjects: book.subjects,
    pageCount: book.pageCount,
    firstPublishYear: book.firstPublishYear,
    rating: book.rating,
    note: book.note,
    startedAt: book.startedAt,
    finishedAt: book.finishedAt,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

function bookStatusToToken(status: Book["status"]): ShelfStatusToken | undefined {
  switch (status) {
    case "wantToRead":
      return STATUS.wantToRead;
    case "reading":
      return STATUS.reading;
    case "finished":
      return STATUS.finished;
    case "abandoned":
      return STATUS.abandoned;
    default:
      return undefined;
  }
}

/**
 * Convert a `ReadBookEntry` (a finished-read marker) into a finished
 * shelf entry. ReadBookEntry only carries title/author/workId, so the
 * record will be sparse — but the status alone is the meaningful bit.
 */
export function readEntryToShelfRecord(
  entry: ReadBookEntry,
  now: Date = new Date(),
): ShelfEntryRecord {
  const ids: BookIds = {};
  if (entry.workId) ids.olWorkId = entry.workId;
  return {
    status: STATUS.finished,
    title: entry.title,
    authors: [{ name: entry.author || "Unknown" }],
    ids,
    finishedAt: new Date(entry.markedAt).toISOString(),
    createdAt: new Date(entry.markedAt).toISOString(),
    updatedAt: now.toISOString(),
  };
}

/** Pick the best identifier from the record and reconstruct a Book. */
export function shelfRecordToBook(
  record: ShelfEntryRecord,
  source: Book["source"] = "unknown",
): Book {
  const id = bookIdFromRecord(record);
  const authorName = record.authors.map((a) => a.name).join(", ") || "Unknown";
  return {
    id,
    title: record.title,
    author: authorName,
    isbn13: record.ids.isbn13,
    imageUrl: record.coverUrl,
    source: source,
    sourceUrl: record.sourceUrl,
    workId: record.ids.olWorkId,
    canonicalTitle: record.title,
    canonicalAuthor: authorName,
    subjects: record.subjects,
    pageCount: record.pageCount,
    firstPublishYear: record.firstPublishYear,
    manual: record.source === "manual" ? true : undefined,
    status: tokenToBookStatus(record.status),
    rating: record.rating,
    note: record.note,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
  };
}

function tokenToBookStatus(token: string | undefined): Book["status"] {
  switch (statusTokenName(token)) {
    case "wantToRead":
      return "wantToRead";
    case "reading":
      return "reading";
    case "finished":
      return "finished";
    case "abandoned":
      return "abandoned";
    default:
      return undefined;
  }
}

export function shelfRecordToReadEntry(record: ShelfEntryRecord): ReadBookEntry {
  const author = record.authors.map((a) => a.name).join(", ") || "Unknown";
  const markedAt = record.finishedAt
    ? Date.parse(record.finishedAt)
    : record.updatedAt
      ? Date.parse(record.updatedAt)
      : Date.parse(record.createdAt);
  const workId = record.ids.olWorkId;
  const key = workId
    ? `work:${workId}`
    : `fuzzy:${normalizeForKey(record.title)}\0${normalizeForKey(author)}`;
  return {
    key,
    title: record.title,
    author,
    workId,
    markedAt: Number.isFinite(markedAt) ? markedAt : Date.now(),
  };
}

function normalizeForKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function bookIdFromRecord(record: ShelfEntryRecord): string {
  if (record.ids.olWorkId) return `pds-ol-${record.ids.olWorkId}`;
  if (record.ids.isbn13) return `pds-isbn-${record.ids.isbn13}`;
  if (record.ids.hiveId) return `pds-bh-${record.ids.hiveId}`;
  // Fall back to a stable hash of title+first author so the same record
  // always produces the same id within a session.
  const author = record.authors[0]?.name ?? "";
  return `pds-fuzzy-${normalizeForKey(record.title)}-${normalizeForKey(author)}`;
}

export function statusFromToken(token: string | undefined): ShelfStatusToken | undefined {
  switch (statusTokenName(token)) {
    case "wantToRead":
      return STATUS.wantToRead;
    case "reading":
      return STATUS.reading;
    case "finished":
      return STATUS.finished;
    case "abandoned":
      return STATUS.abandoned;
    default:
      return undefined;
  }
}

// --- Author follow ---

export function authorEntryToRecord(
  author: AuthorEntry,
  now: Date = new Date(),
): AuthorFollowRecord {
  return {
    name: author.name,
    olAuthorKey: author.olKey,
    imageUrl: author.imageUrl,
    createdAt: now.toISOString(),
  };
}

export function authorRecordToEntry(record: AuthorFollowRecord, rkey: string): AuthorEntry {
  return {
    id: `pds-author-${rkey}`,
    name: record.name,
    olKey: record.olAuthorKey,
    imageUrl: record.imageUrl,
  };
}

// --- Dismissed ---

export function dismissedToRecord(
  entry: DismissedWorkEntry,
  now: Date = new Date(),
): BookDismissedRecord | null {
  // We only emit a record when we have at least an identifier. Pure fuzzy
  // entries that lack a workId can't form a portable identifier — we keep
  // them in localStorage but don't push them to the PDS, since other
  // clients couldn't match against them anyway.
  const ids: BookIds = {};
  if (entry.workId) ids.olWorkId = entry.workId;
  if (Object.keys(ids).length === 0) return null;
  const record: BookDismissedRecord = {
    ids,
    createdAt: new Date(entry.dismissedAt).toISOString(),
  };
  if (entry.title) record.title = entry.title;
  if (entry.author) record.authors = [{ name: entry.author }];
  return record;
}

export function dismissedRecordToEntry(record: BookDismissedRecord): DismissedWorkEntry {
  const dismissedAt = Date.parse(record.createdAt);
  const workId = record.ids.olWorkId;
  const title = record.title ?? "";
  const author = record.authors?.[0]?.name ?? "";
  const key = workId
    ? `work:${workId}`
    : `fuzzy:${normalizeForKey(title)}\0${normalizeForKey(author)}`;
  return {
    key,
    workId,
    title: title || undefined,
    author: author || undefined,
    dismissedAt: Number.isFinite(dismissedAt) ? dismissedAt : Date.now(),
  };
}
