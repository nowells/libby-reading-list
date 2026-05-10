import { useEffect, useCallback, useRef, useState, useSyncExternalStore } from "react";
import type { AuthorEntry, LibraryConfig } from "~/lib/storage";
import { resolveAuthorKey, getAuthorWorks } from "~/lib/openlibrary-author";
import { searchLibrary, type LibbyMediaItem, type AvailabilityInfo } from "~/lib/libby";
import {
  getCachedAuthor,
  setCachedAuthor,
  readAuthorCache,
  authorCacheMaxAge,
  whenAuthorAvailabilityCacheReady,
} from "../lib/cache";
import { extractAvailability, getFormatType, dedupeWorks, dedupeLibbyResults } from "../lib/utils";

export interface AuthorBookResult {
  title: string;
  firstPublishYear?: number;
  coverId?: number;
  olWorkKey: string;
  libbyResults: LibbyFormatResult[];
}

export interface LibbyFormatResult {
  mediaItem: LibbyMediaItem;
  availability: AvailabilityInfo;
  formatType: string;
  libraryKey: string;
}

export type AuthorLoadStatus = "idle" | "loading-works" | "loading-availability" | "done" | "error";

export interface AuthorAvailState {
  status: AuthorLoadStatus;
  olKey?: string;
  resolvedName?: string;
  works: AuthorBookResult[];
  progress?: { done: number; total: number };
  error?: string;
  fetchedAt?: number;
}

// Module-level state lives outside the React tree so an in-flight sync (and
// the resulting progress UI) survives navigating away and back. Without this,
// adding a new author and immediately clicking into one of her books would
// orphan the in-flight Libby calls — on return the new mount saw an empty
// stateMap, missed the not-yet-written cache, and re-fired the whole sync
// for that author. Now: state is shared across mounts, and concurrent loads
// for the same author share a single Promise via `inFlightLoads`.
let globalStateMap: Record<string, AuthorAvailState> = {};
const subscribers = new Set<() => void>();
const inFlightLoads = new Map<string, Promise<void>>();

function setGlobalState(
  updater: (prev: Record<string, AuthorAvailState>) => Record<string, AuthorAvailState>,
) {
  globalStateMap = updater(globalStateMap);
  for (const cb of subscribers) cb();
}

function subscribe(cb: () => void) {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

function getSnapshot() {
  return globalStateMap;
}

/** Test-only: clear shared state between test cases. */
export function __resetAuthorAvailabilityForTests() {
  globalStateMap = {};
  inFlightLoads.clear();
  for (const cb of subscribers) cb();
}

async function loadAuthor(
  author: AuthorEntry,
  libraries: LibraryConfig[],
  loadOpts: { skipCache?: boolean } = {},
): Promise<void> {
  // Coalesce: if a load is already in flight for this author (e.g. started
  // by a previous mount that has since unmounted), share its Promise rather
  // than re-firing the network calls.
  const existing = inFlightLoads.get(author.id);
  if (existing) return existing;

  const promise = (async () => {
    // Cache check
    if (!loadOpts.skipCache) {
      // Cache is IDB-backed and hydrates asynchronously. Await hydration so a
      // cold load doesn't refire the entire author resolve + Libby fanout
      // when a fresh cached entry is sitting in IDB.
      await whenAuthorAvailabilityCacheReady();
      const cached = getCachedAuthor(author.id);
      if (cached) {
        setGlobalState((prev) => ({
          ...prev,
          [author.id]: {
            status: "done",
            olKey: cached.olKey,
            resolvedName: cached.resolvedName,
            works: cached.works,
            fetchedAt: cached.fetchedAt,
          },
        }));
        return;
      }
    }

    setGlobalState((prev) => ({
      ...prev,
      [author.id]: {
        ...prev[author.id],
        status: "loading-works",
        works: prev[author.id]?.works ?? [],
      },
    }));

    try {
      // 1. Resolve author to Open Library key
      const resolved = author.olKey
        ? { key: author.olKey, name: author.name }
        : await resolveAuthorKey(author.name);

      if (!resolved) {
        setGlobalState((prev) => ({
          ...prev,
          [author.id]: {
            status: "error",
            works: [],
            error: `Could not find "${author.name}" on Open Library`,
          },
        }));
        return;
      }

      // 2. Fetch all works
      const works = await getAuthorWorks(resolved.key);

      setGlobalState((prev) => ({
        ...prev,
        [author.id]: {
          status: "loading-availability",
          olKey: resolved.key,
          resolvedName: resolved.name,
          works: works.map((w) => ({
            title: w.title,
            firstPublishYear: w.firstPublishYear,
            coverId: w.coverId,
            olWorkKey: w.key,
            libbyResults: [],
          })),
          progress: { done: 0, total: works.length },
        },
      }));

      // 3. Search Libby for each work across all libraries
      const CONCURRENCY = 3;
      let cursor = 0;
      let done = 0;
      const results: AuthorBookResult[] = [];

      async function worker() {
        while (cursor < works.length) {
          const idx = cursor++;
          const work = works[idx];
          const libbyResults: LibbyFormatResult[] = [];

          // Search each library for this title + author
          for (const lib of libraries) {
            try {
              const items = await searchLibrary(lib.key, `${work.title} ${author.name}`);
              // Filter to items that match the author name
              for (const item of items) {
                const itemAuthor = item.creators?.find((c) => c.role === "Author")?.name ?? "";
                const authorLower = author.name.toLowerCase();
                const itemAuthorLower = itemAuthor.toLowerCase();
                // Check if author names overlap (at least last name match)
                const authorParts = authorLower.split(/\s+/);
                const lastName = authorParts[authorParts.length - 1];
                if (!itemAuthorLower.includes(lastName)) continue;

                // Check title similarity
                const workTitleLower = work.title.toLowerCase().replace(/[^a-z0-9\s]/g, "");
                const itemTitleLower = item.title.toLowerCase().replace(/[^a-z0-9\s]/g, "");
                if (
                  !itemTitleLower.includes(workTitleLower) &&
                  !workTitleLower.includes(itemTitleLower)
                ) {
                  // Looser check: compare significant words
                  const workWords = workTitleLower.split(/\s+/).filter((w) => w.length > 2);
                  const matchCount = workWords.filter((w) => itemTitleLower.includes(w)).length;
                  if (matchCount < workWords.length * 0.5) continue;
                }

                libbyResults.push({
                  mediaItem: item,
                  availability: extractAvailability(item),
                  formatType: getFormatType(item),
                  libraryKey: lib.key,
                });
              }
            } catch {
              // Skip library errors
            }
          }

          // Dedupe by library+mediaItem
          const deduped = dedupeLibbyResults(libbyResults);

          results[idx] = {
            title: work.title,
            firstPublishYear: work.firstPublishYear,
            coverId: work.coverId,
            olWorkKey: work.key,
            libbyResults: deduped,
          };

          done++;
          setGlobalState((prev) => ({
            ...prev,
            [author.id]: {
              ...prev[author.id],
              progress: { done, total: works.length },
            },
          }));
        }
      }

      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, works.length) }, worker));

      // Deduplicate works by normalized title
      const dedupedResults = dedupeWorks(results.filter(Boolean));

      // Sort: books with availability first, then by year descending
      dedupedResults.sort((a, b) => {
        const aHas = a.libbyResults.length > 0 ? 1 : 0;
        const bHas = b.libbyResults.length > 0 ? 1 : 0;
        if (bHas !== aHas) return bHas - aHas;
        const ya = a.firstPublishYear ?? 0;
        const yb = b.firstPublishYear ?? 0;
        return yb - ya;
      });

      // Cache the result
      setCachedAuthor(author.id, resolved.key, resolved.name, dedupedResults);

      setGlobalState((prev) => ({
        ...prev,
        [author.id]: {
          status: "done",
          olKey: resolved.key,
          resolvedName: resolved.name,
          works: dedupedResults,
          fetchedAt: Date.now(),
        },
      }));
    } catch (err) {
      setGlobalState((prev) => ({
        ...prev,
        [author.id]: {
          status: "error",
          works: [],
          error: err instanceof Error ? err.message : "Unknown error",
        },
      }));
    }
  })().finally(() => {
    inFlightLoads.delete(author.id);
  });

  inFlightLoads.set(author.id, promise);
  return promise;
}

export function useAuthorAvailability(
  authors: AuthorEntry[],
  libraries: LibraryConfig[],
  opts?: { loadOrder?: string[] },
) {
  const stateMap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [refreshToken, setRefreshToken] = useState(0);
  const refreshingRef = useRef(false);
  const loadOrderRef = useRef<string[] | undefined>(opts?.loadOrder);
  loadOrderRef.current = opts?.loadOrder;

  // Load all authors on mount (or force refresh)
  useEffect(() => {
    refreshingRef.current = true;
    let cancelled = false;
    const forceRefresh = refreshToken > 0;

    async function loadAll() {
      // Sort authors by preferred load order (e.g. visible-first) when available
      const ordered = loadOrderRef.current
        ? [...authors].sort((a, b) => {
            const ai = loadOrderRef.current!.indexOf(a.id);
            const bi = loadOrderRef.current!.indexOf(b.id);
            // Authors not in the load order go last
            return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
          })
        : authors;
      for (const author of ordered) {
        if (cancelled) break;
        // Skip if already loaded (unless force refresh)
        if (!forceRefresh && globalStateMap[author.id]?.status === "done") continue;
        await loadAuthor(author, libraries, { skipCache: forceRefresh });
      }
      refreshingRef.current = false;
    }

    void loadAll();

    return () => {
      cancelled = true;
    };
  }, [authors, libraries, refreshToken]);

  // Background auto-refresh: check every 30 min for stale cached entries
  useEffect(() => {
    const INTERVAL_MS = 30 * 60 * 1000;
    const bgRefreshingRef = { current: false };

    const timer = setInterval(async () => {
      if (bgRefreshingRef.current || refreshingRef.current) return;
      bgRefreshingRef.current = true;

      try {
        const cache = readAuthorCache();
        const stale: AuthorEntry[] = [];
        for (const author of authors) {
          const entry = cache[author.id];
          if (!entry) continue;
          if (Date.now() - entry.fetchedAt > authorCacheMaxAge(entry)) {
            stale.push(author);
          }
        }

        if (stale.length === 0) return;

        for (const author of stale) {
          await loadAuthor(author, libraries, { skipCache: true });
        }
      } finally {
        bgRefreshingRef.current = false;
      }
    }, INTERVAL_MS);

    return () => clearInterval(timer);
  }, [authors, libraries]);

  const refreshAuthor = useCallback(
    (author: AuthorEntry) => {
      void loadAuthor(author, libraries, { skipCache: true });
    },
    [libraries],
  );

  const refreshAll = useCallback(() => {
    if (refreshingRef.current) return;
    setRefreshToken((t) => t + 1);
  }, []);

  // Compute loading stats
  const checkedCount = Object.values(stateMap).filter((s) => s.status === "done").length;
  const loadingCount = Object.values(stateMap).filter(
    (s) => s.status === "loading-works" || s.status === "loading-availability",
  ).length;

  const oldestFetchedAt = (() => {
    let oldest: number | null = null;
    for (const s of Object.values(stateMap)) {
      if (s.fetchedAt && (oldest === null || s.fetchedAt < oldest)) {
        oldest = s.fetchedAt;
      }
    }
    return oldest;
  })();

  return { stateMap, refreshAuthor, refreshAll, checkedCount, loadingCount, oldestFetchedAt };
}
