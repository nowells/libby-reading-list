/**
 * Shapes shared by the mock helpers. These intentionally mirror the
 * payloads the real Libby / Open Library / ATproto endpoints return,
 * but only carry the fields the app actually reads.
 */

export interface MockBook {
  /** Unique within the catalog. Used as the Libby title id. */
  id: string;
  title: string;
  author: string;
  isbn13?: string;
  workId?: string;
  /** Author key used for /authors/<key>/works lookups. */
  olAuthorKey?: string;
  coverHref?: string;
  /** "ebook" or "audiobook" — the Libby format type. */
  formatType?: "ebook" | "audiobook";
  ownedCopies?: number;
  availableCopies?: number;
  holdsCount?: number;
  isAvailable?: boolean;
  estimatedWaitDays?: number;
  publisher?: string;
  publishDate?: string;
  subjects?: string[];
  firstPublishYear?: number;
}

export interface MockLibrary {
  /** Libby fulfillment id (e.g. "lapl"). */
  key: string;
  /** preferredKey returned by the /libraries/{key} endpoint. Defaults to `key`. */
  preferredKey?: string;
  name: string;
  type?: string;
  logoUrl?: string;
}

export interface MockAuthor {
  /** Open Library author key, e.g. "OL7313085A". */
  key: string;
  name: string;
  workCount?: number;
  topWork?: string;
  /** Works to return for /authors/{key}/works.json. */
  works?: { title: string; firstPublishYear?: number; workId: string }[];
}

/** A record stored in our in-memory PDS, keyed by collection NSID and rkey. */
export interface PdsRecord {
  uri: string;
  cid: string;
  value: Record<string, unknown>;
}
