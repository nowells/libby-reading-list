import type { LibbyMediaItem } from "~/lib/libby";

export function getAuthor(item: LibbyMediaItem): string {
  return item.creators?.find((c) => c.role === "Author")?.name ?? "";
}

/** Normalize a string for dedup comparison: lowercase, strip all non-alphanumeric chars */
export function normalizeForDedup(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Deduplicate items by normalized sortTitle+creator, preferring items with cover art */
export function deduplicateItems(items: LibbyMediaItem[]): LibbyMediaItem[] {
  const seen = new Map<string, LibbyMediaItem>();
  for (const item of items) {
    const creator = item.firstCreatorSortName ?? getAuthor(item);
    const key = `${normalizeForDedup(item.sortTitle)}\0${normalizeForDedup(creator)}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, item);
    } else if (!existing.covers?.cover150Wide?.href && item.covers?.cover150Wide?.href) {
      seen.set(key, item);
    }
  }
  return [...seen.values()];
}
