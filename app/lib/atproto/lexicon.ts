/**
 * NSIDs for the org.shelfcheck.* lexicon. Lexicon JSON files live under
 * public/lexicons/ and are served at https://www.shelfcheck.org/lexicons/<nsid>.json.
 */
export const NSID = {
  shelfEntry: "org.shelfcheck.shelf.entry",
  authorFollow: "org.shelfcheck.author.follow",
  bookDismissed: "org.shelfcheck.book.dismissed",
} as const;

export const STATUS = {
  wantToRead: "org.shelfcheck.defs#wantToRead",
  reading: "org.shelfcheck.defs#reading",
  finished: "org.shelfcheck.defs#finished",
  abandoned: "org.shelfcheck.defs#abandoned",
} as const;

export type ShelfStatusToken = (typeof STATUS)[keyof typeof STATUS];

/** Identifiers correlating a book across catalogs. */
export interface BookIds {
  /** Open Library Work ID (e.g. "OL45883W"). Primary correlation key. */
  olWorkId?: string;
  isbn13?: string;
  isbn10?: string;
  /** BookHive canonical book id, when imported from buzz.bookhive.book. */
  hiveId?: string;
  goodreadsId?: string;
}

export interface AuthorRef {
  name: string;
  /** Open Library author key (e.g. "OL23919A"). */
  olAuthorKey?: string;
}

export interface ShelfEntryRecord {
  $type?: typeof NSID.shelfEntry;
  status: ShelfStatusToken;
  title: string;
  authors: AuthorRef[];
  ids: BookIds;
  source?: string;
  sourceUrl?: string;
  coverUrl?: string;
  subjects?: string[];
  pageCount?: number;
  firstPublishYear?: number;
  startedAt?: string;
  finishedAt?: string;
  /** 0-100, half-star resolution (10 == 0.5★, 20 == 1★, ..., 100 == 5★). */
  rating?: number;
  note?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface AuthorFollowRecord {
  $type?: typeof NSID.authorFollow;
  name: string;
  olAuthorKey?: string;
  imageUrl?: string;
  createdAt: string;
}

export interface BookDismissedRecord {
  $type?: typeof NSID.bookDismissed;
  ids: BookIds;
  title?: string;
  authors?: AuthorRef[];
  reason?: string;
  createdAt: string;
}

/**
 * Token form ('wantToRead') from a status string that may be either a token
 * reference ('org.shelfcheck.defs#wantToRead') or the bare token. Returns
 * undefined for unknown values.
 */
export function statusTokenName(status: string | undefined): string | undefined {
  if (!status) return undefined;
  const hash = status.lastIndexOf("#");
  return hash >= 0 ? status.slice(hash + 1) : status;
}
