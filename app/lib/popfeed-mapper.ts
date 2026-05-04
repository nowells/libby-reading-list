import type { Book, ShelfStatus } from "./storage";

/**
 * Shape of a `social.popfeed.feed.list` record. We only model the fields we
 * read; everything else is tolerated and ignored.
 *
 * Lexicon: https://github.com/Popfeed-Social/Popfeed-Community/blob/main/lexicons/list.json
 */
export interface PopfeedListRecord {
  $type?: string;
  name: string;
  description?: string;
  tags?: string[];
  /** Free-form list type: "watchlist" | "favorites" | "to-read" | etc. */
  listType?: string;
  createdAt?: string;
  ordered?: boolean;
  itemOrder?: string[];
}

export interface PopfeedListEntry {
  uri: string;
  cid?: string;
  value: PopfeedListRecord;
}

/**
 * Shape of a `social.popfeed.feed.listItem` record. Only the book-relevant
 * fields are typed; non-book creative work types are filtered out.
 *
 * Lexicon: https://github.com/Popfeed-Social/Popfeed-Community/blob/main/lexicons/listItem.json
 */
export interface PopfeedListItemRecord {
  $type?: string;
  /** AT-URI of the parent `social.popfeed.feed.list` record. */
  listUri: string;
  /** Denormalized copy of parent list's `listType`, when present. */
  listType?: string;
  /**
   * "movie" | "tv_show" | "video_game" | "album" | "book" | "book_series" |
   * "episode" | "ep" | "tv_season" | "tv_episode" | "track"
   */
  creativeWorkType: string;
  /** Item status reference, e.g. "#finished" | "#in_progress" | "#backlog" | "#abandoned". */
  status?: string;
  title?: string;
  /** Author name for books (single string; usually one author). */
  mainCredit?: string;
  mainCreditRole?: string;
  identifiers?: {
    isbn10?: string;
    isbn13?: string;
    asin?: string;
    hiveId?: string;
    other?: string;
    [k: string]: unknown;
  };
  /** External cover image URL (preferred over the blob form for our use). */
  posterUrl?: string;
  releaseDate?: string;
  genres?: string[];
  description?: string;
  addedAt?: string;
}

export interface PopfeedListItemEntry {
  uri: string;
  cid?: string;
  value: PopfeedListItemRecord;
}

function rkeyFromAtUri(uri: string): string {
  const parts = uri.split("/");
  return parts[parts.length - 1] || uri;
}

function normalizeIsbn(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const digits = s.replace(/\D/g, "");
  return digits.length === 13 ? digits : undefined;
}

/**
 * Match the conventional "to-read" list. Popfeed's lexicon documents
 * `to-read` as the canonical token but real users may have hyphen, underscore
 * or space variants — accept all of them. Falls back to the user-visible name
 * when `listType` is unset (some clients only set `name`).
 */
export function isToReadList(record: PopfeedListRecord): boolean {
  const listType = (record.listType ?? "").trim().toLowerCase();
  if (/^to[-_ ]read(?:[-_ ]books?)?$/.test(listType)) return true;
  const name = (record.name ?? "").trim().toLowerCase();
  if (/^(want\s+to\s+read|to\s+read|reading\s+list)$/.test(name)) return true;
  return false;
}

/**
 * Match a "currently reading" list. Accepts common variants of the label.
 */
export function isReadingList(record: PopfeedListRecord): boolean {
  const listType = (record.listType ?? "").trim().toLowerCase();
  if (/^(currently[-_ ]reading([-_ ]books?)?|reading|in[-_ ]progress)$/.test(listType)) return true;
  const name = (record.name ?? "").trim().toLowerCase();
  if (/^(currently\s+reading|reading|in\s+progress)$/.test(name)) return true;
  return false;
}

/**
 * Match a "read" / "finished" list. Accepts common variants.
 */
export function isFinishedList(record: PopfeedListRecord): boolean {
  const listType = (record.listType ?? "").trim().toLowerCase();
  if (/^(read([-_ ]books?)?|finished([-_ ]books?)?)$/.test(listType)) return true;
  const name = (record.name ?? "").trim().toLowerCase();
  if (/^(read|finished|books\s+read|completed)$/.test(name)) return true;
  return false;
}

/**
 * Classify a list record into a ShelfStatus, or return undefined if it's not
 * a book-related list we recognise.
 */
export function classifyList(record: PopfeedListRecord): ShelfStatus | undefined {
  if (isToReadList(record)) return "wantToRead";
  if (isReadingList(record)) return "reading";
  if (isFinishedList(record)) return "finished";
  return undefined;
}

/**
 * Find every popfeed list whose listType (or name) marks it as a "to-read"
 * collection. Returns the original entries so callers can read AT-URIs +
 * record metadata.
 */
export function pickToReadLists(entries: PopfeedListEntry[]): PopfeedListEntry[] {
  return entries.filter((e) => isToReadList(e.value));
}

/**
 * Find every popfeed list that maps to a recognised book shelf status.
 * Returns entries paired with their default ShelfStatus.
 */
export function pickBookLists(
  entries: PopfeedListEntry[],
): { entry: PopfeedListEntry; defaultStatus: ShelfStatus }[] {
  const result: { entry: PopfeedListEntry; defaultStatus: ShelfStatus }[] = [];
  for (const e of entries) {
    const status = classifyList(e.value);
    if (status) result.push({ entry: e, defaultStatus: status });
  }
  return result;
}

/** Map a popfeed item-level status token to a ShelfStatus. */
function mapItemStatus(raw: string | undefined): ShelfStatus | undefined {
  if (!raw) return undefined;
  const token = raw.replace(/^.*#/, "").toLowerCase();
  switch (token) {
    case "in_progress":
      return "reading";
    case "finished":
      return "finished";
    case "abandoned":
      return "abandoned";
    case "backlog":
      return "wantToRead";
    default:
      return undefined;
  }
}

/**
 * Convert popfeed listItem records into shelfcheck Books, keeping only items
 * that belong to one of the provided list URIs.
 *
 * `listStatusMap` maps each list AT-URI to its default ShelfStatus (derived
 * from the list type). An item's own status overrides the list default.
 */
export function popfeedItemsToBooks(
  entries: PopfeedListItemEntry[],
  listStatusMap: Map<string, ShelfStatus>,
): Book[] {
  const books: Book[] = [];
  for (const entry of entries) {
    const rec = entry.value;
    if (!rec) continue;
    if (rec.creativeWorkType !== "book" && rec.creativeWorkType !== "book_series") continue;
    const listDefault = listStatusMap.get(rec.listUri);
    if (listDefault === undefined) continue;
    if (!rec.title) continue;

    const status = mapItemStatus(rec.status) ?? listDefault;

    const rkey = rkeyFromAtUri(entry.uri);
    const isbn13 = normalizeIsbn(rec.identifiers?.isbn13) ?? normalizeIsbn(rec.identifiers?.isbn10);
    const author = (rec.mainCredit ?? "").trim();
    books.push({
      id: `pf-${rkey}`,
      title: rec.title,
      author,
      isbn13,
      imageUrl: rec.posterUrl,
      source: "popfeed",
      sourceUrl: rec.identifiers?.hiveId
        ? `https://bookhive.buzz/books/${rec.identifiers.hiveId}`
        : undefined,
      status,
    });
  }
  return books;
}
