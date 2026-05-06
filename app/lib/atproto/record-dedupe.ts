import { STATUS, type AuthorFollowRecord, type ShelfEntryRecord } from "./lexicon";
import { statusFromToken } from "./mappers";

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Cluster items via union-find on overlapping keys: any pair sharing at
 * least one key returned by `keysOf` lands in the same group. Returns
 * the highest-scoring item per group as `unique`; everything else as
 * `duplicates`.
 *
 * We use this for both PDS-side cleanup (where duplicates need to be
 * deleted) and read-side display (where consumers just want the
 * canonical record per work).
 */
export function dedupeWithUnionFind<T>(
  items: T[],
  keysOf: (item: T) => string[],
  scoreOf: (item: T) => number,
): { unique: T[]; duplicates: T[] } {
  const parent: number[] = items.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const byKey = new Map<string, number>();
  for (let i = 0; i < items.length; i++) {
    for (const k of keysOf(items[i])) {
      const seen = byKey.get(k);
      if (seen !== undefined) union(i, seen);
      else byKey.set(k, i);
    }
  }

  const groups = new Map<number, T[]>();
  for (let i = 0; i < items.length; i++) {
    const root = find(i);
    const arr = groups.get(root);
    if (arr) arr.push(items[i]);
    else groups.set(root, [items[i]]);
  }

  const unique: T[] = [];
  const duplicates: T[] = [];
  for (const arr of groups.values()) {
    if (arr.length === 1) {
      unique.push(arr[0]);
      continue;
    }
    const sorted = [...arr].sort((a, b) => scoreOf(b) - scoreOf(a));
    unique.push(sorted[0]);
    for (let i = 1; i < sorted.length; i++) duplicates.push(sorted[i]);
  }
  return { unique, duplicates };
}

/**
 * Keys a shelf entry contributes to a dedupe group: the workId-keyed
 * form (`work:<olWorkId>`) when present, plus a fuzzy form derived from
 * normalized title+author. Records sharing *either* key collapse into
 * one group, so a workId-tagged record and a fuzzy-only sibling for the
 * same book don't slip past as distinct.
 */
export function shelfRecordKeys(record: ShelfEntryRecord): string[] {
  const author = record.authors?.[0]?.name ?? "";
  const fuzzy = `fuzzy:${normalize(record.title)}\0${normalize(author)}`;
  const work = record.ids?.olWorkId ? `work:${record.ids.olWorkId}` : null;
  return work ? [work, fuzzy] : [fuzzy];
}

/**
 * Score a shelf entry for dedupe winner selection. User-authored data
 * (rating, note, started/finished) is preserved at all costs; non-default
 * status, then metadata richness, then recency break ties.
 */
export function shelfRecordScore(record: ShelfEntryRecord): number {
  let score = 0;
  if (typeof record.rating === "number") score += 1000;
  if (record.note) score += 1000;
  if (record.startedAt) score += 200;
  if (record.finishedAt) score += 200;
  const status = statusFromToken(record.status);
  if (status && status !== STATUS.wantToRead) score += 100;
  if (record.ids?.olWorkId) score += 50;
  if (record.coverUrl) score += 10;
  if (record.subjects && record.subjects.length > 0) score += 10;
  if (typeof record.pageCount === "number") score += 5;
  if (typeof record.firstPublishYear === "number") score += 5;
  if (record.sourceUrl) score += 3;
  const ts = Date.parse(record.updatedAt ?? record.createdAt);
  if (Number.isFinite(ts)) score += ts / 1e12;
  return score;
}

/**
 * Collapse duplicate shelf entries down to one record per work. Used by
 * friend-side reads so a stale PDS with duplicate records still surfaces
 * a clean shelf without waiting for that user to upgrade.
 */
export function dedupeShelfRecords(records: ShelfEntryRecord[]): ShelfEntryRecord[] {
  return dedupeWithUnionFind(records, shelfRecordKeys, shelfRecordScore).unique;
}

export function authorRecordKeys(record: AuthorFollowRecord): string[] {
  const nameKey = `name:${record.name.toLowerCase()}`;
  const olKey = record.olAuthorKey ? `key:${record.olAuthorKey}` : null;
  return olKey ? [olKey, nameKey] : [nameKey];
}

export function authorRecordScore(record: AuthorFollowRecord): number {
  let s = 0;
  if (record.olAuthorKey) s += 50;
  if (record.imageUrl) s += 10;
  const ts = Date.parse(record.createdAt);
  if (Number.isFinite(ts)) s += ts / 1e12;
  return s;
}

/** Friend-side companion to {@link dedupeShelfRecords} for author follows. */
export function dedupeAuthorRecords(records: AuthorFollowRecord[]): AuthorFollowRecord[] {
  return dedupeWithUnionFind(records, authorRecordKeys, authorRecordScore).unique;
}
