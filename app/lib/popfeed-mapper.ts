import type { Book } from "./storage";

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
 * Find every popfeed list whose listType (or name) marks it as a "to-read"
 * collection. Returns the original entries so callers can read AT-URIs +
 * record metadata.
 */
export function pickToReadLists(entries: PopfeedListEntry[]): PopfeedListEntry[] {
  return entries.filter((e) => isToReadList(e.value));
}

/**
 * Convert popfeed listItem records into shelfcheck Books, keeping only items
 * that look like wantToRead books on one of the provided list URIs.
 *
 * `listUris` should be the AT-URIs of the user's identified to-read lists;
 * this filters out items that belong to unrelated lists (movies, watchlists,
 * favorites, etc.) sharing the same collection.
 */
export function popfeedItemsToBooks(
  entries: PopfeedListItemEntry[],
  listUris: Set<string>,
): Book[] {
  const books: Book[] = [];
  for (const entry of entries) {
    const rec = entry.value;
    if (!rec) continue;
    if (rec.creativeWorkType !== "book" && rec.creativeWorkType !== "book_series") continue;
    if (!listUris.has(rec.listUri)) continue;
    if (!rec.title) continue;

    // Skip items the user has marked finished / abandoned — those don't
    // belong on the want-to-read shelf even if they're on a "to-read" list.
    const statusToken = (rec.status ?? "").replace(/^.*#/, "").toLowerCase();
    if (statusToken === "finished" || statusToken === "abandoned") continue;

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
    });
  }
  return books;
}
