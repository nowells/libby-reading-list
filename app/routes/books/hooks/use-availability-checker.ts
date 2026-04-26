import { useState, useEffect, useCallback, useRef } from "react";
import type { Book, LibraryConfig } from "~/lib/storage";
import { updateBook } from "~/lib/storage";
import { findBookInLibrary, type BookAvailability } from "~/lib/libby";
import { getWorkEditionIsbns, enrichBooksWithWorkId } from "~/lib/openlibrary";
import { readCache, cacheMaxAge, getCached, setCached } from "../lib/cache";
import type { BookAvailState } from "../lib/categorize";
import { mergeAvailabilityResults } from "../lib/merge-results";

export function useAvailabilityChecker(
  books: Book[],
  libraries: LibraryConfig[],
  opts?: { onBookEnriched?: (bookId: string, updates: Partial<Book>) => void },
) {
  const [availMap, setAvailMap] = useState<Record<string, BookAvailState>>({});
  const availMapRef = useRef(availMap);
  availMapRef.current = availMap;
  const [refreshToken, setRefreshToken] = useState(0);
  const refreshingRef = useRef(false);
  const onBookEnriched = opts?.onBookEnriched;
  const [enrichmentProgress, setEnrichmentProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  const totalBooks = books.length;
  const checkedCount = Object.values(availMap).filter(
    (s) => s.status === "done" || s.status === "cached",
  ).length;
  const loadingCount = Object.values(availMap).filter((s) => s.status === "loading").length;

  const fetchAndCache = useCallback(
    async (book: Book, fetchOpts: { liveAvailability?: boolean } = {}): Promise<BookAvailState> => {
      try {
        // The primary ISBN is tried first; alternate-edition ISBNs from
        // Open Library are resolved lazily and only fetched when the
        // primary search misses, so books found on their primary ISBN
        // never trigger an OL editions round-trip.
        const workId = book.workId;
        const getAlternateIsbns = workId ? () => getWorkEditionIsbns(workId) : undefined;

        // Search across all libraries and merge results
        const allResults = await Promise.all(
          libraries.map((lib) =>
            findBookInLibrary(
              lib.key,
              book.canonicalTitle ?? book.title,
              book.canonicalAuthor ?? book.author,
              {
                primaryIsbn: book.isbn13,
                getAlternateIsbns,
                liveAvailability: fetchOpts.liveAvailability,
              },
            ).catch(
              () =>
                ({
                  bookTitle: book.canonicalTitle ?? book.title,
                  bookAuthor: book.canonicalAuthor ?? book.author,
                  results: [],
                }) as BookAvailability,
            ),
          ),
        );

        const merged = mergeAvailabilityResults(
          allResults,
          book.canonicalTitle ?? book.title,
          book.canonicalAuthor ?? book.author,
        );
        setCached(book.id, merged);
        if (merged.coverUrl && !book.imageUrl) {
          updateBook(book.id, { imageUrl: merged.coverUrl });
        }
        return { status: "done", data: merged, fetchedAt: Date.now() };
      } catch {
        const fallback: BookAvailability = {
          bookTitle: book.canonicalTitle ?? book.title,
          bookAuthor: book.canonicalAuthor ?? book.author,
          results: [],
        };
        return { status: "done", data: fallback, fetchedAt: Date.now() };
      }
    },
    [libraries],
  );

  const refreshBook = useCallback(
    async (book: Book) => {
      setAvailMap((prev) => ({
        ...prev,
        [book.id]: { ...prev[book.id], status: "loading" },
      }));

      // Re-enrich from OpenLibrary if this book is missing a workId
      let enrichedBook = book;
      if (!book.workId && (book.isbn13 || (book.title && book.author))) {
        setEnrichmentProgress({ done: 0, total: 1 });
        const [result] = await enrichBooksWithWorkId([book]);
        setEnrichmentProgress(null);
        if (result.workId) {
          enrichedBook = result;
          const updates: Partial<Book> = {
            workId: result.workId,
            canonicalTitle: result.canonicalTitle,
            canonicalAuthor: result.canonicalAuthor,
            isbn13: result.isbn13,
          };
          updateBook(book.id, updates);
          onBookEnriched?.(book.id, updates);
        }
      }

      // Per-book refresh hits the canonical /availability endpoint so the
      // numbers shown here aren't subject to Libby's CDN cache. Bulk and
      // background refreshes stay search-embedded to keep request volume
      // sane on a 100+ book library.
      const result = await fetchAndCache(enrichedBook, { liveAvailability: true });
      setAvailMap((prev) => ({ ...prev, [book.id]: result }));
    },
    [fetchAndCache, onBookEnriched],
  );

  const refreshAll = useCallback(() => {
    if (refreshingRef.current) return;
    setRefreshToken((t) => t + 1);
  }, []);

  useEffect(() => {
    refreshingRef.current = true;
    const cancelledRef = { current: false };

    const forceRefresh = refreshToken > 0;

    const initial: Record<string, BookAvailState> = {};
    const toFetch: Book[] = [];

    for (const book of books) {
      if (forceRefresh) {
        // Keep existing data visible while refreshing
        const existing = availMapRef.current[book.id];
        initial[book.id] = existing?.data
          ? { ...existing, status: "loading" }
          : { status: "pending" };
        toFetch.push(book);
        continue;
      }
      const cached = getCached(book.id);
      if (cached) {
        initial[book.id] = {
          status: "cached",
          data: cached.data,
          fetchedAt: cached.fetchedAt,
        };
      } else {
        initial[book.id] = { status: "pending" };
        toFetch.push(book);
      }
    }
    setAvailMap(initial);

    if (toFetch.length === 0) {
      refreshingRef.current = false;
      return;
    }

    // Re-enrich books missing workId from OpenLibrary before availability check
    const needsEnrichment = toFetch.filter((b) => !b.workId && (b.isbn13 || (b.title && b.author)));

    const enrichmentDone =
      needsEnrichment.length > 0
        ? enrichBooksWithWorkId(needsEnrichment, {
            onProgress: (done, total) => setEnrichmentProgress({ done, total }),
          }).then((enrichedBooks) => {
            setEnrichmentProgress(null);
            if (cancelledRef.current) return;
            const enrichedMap = new Map<string, Book>();
            for (let i = 0; i < needsEnrichment.length; i++) {
              const orig = needsEnrichment[i];
              const result = enrichedBooks[i];
              if (result.workId && result.workId !== orig.workId) {
                enrichedMap.set(orig.id, result);
                const updates: Partial<Book> = {
                  workId: result.workId,
                  canonicalTitle: result.canonicalTitle,
                  canonicalAuthor: result.canonicalAuthor,
                  isbn13: result.isbn13,
                };
                updateBook(orig.id, updates);
                onBookEnriched?.(orig.id, updates);
              }
            }
            // Update toFetch entries in-place with enriched data
            for (let i = 0; i < toFetch.length; i++) {
              const updated = enrichedMap.get(toFetch[i].id);
              if (updated) toFetch[i] = updated;
            }
          })
        : Promise.resolve();

    const CONCURRENCY = 4;
    let idx = 0;

    async function processNext(): Promise<void> {
      await enrichmentDone;
      while (idx < toFetch.length && !cancelledRef.current) {
        const current = idx++;
        const book = toFetch[current];
        setAvailMap((prev) => ({
          ...prev,
          [book.id]: { ...prev[book.id], status: "loading" },
        }));
        const result = await fetchAndCache(book);
        if (!cancelledRef.current) {
          setAvailMap((prev) => ({ ...prev, [book.id]: result }));
        }
      }
    }

    const workers = Array.from({ length: Math.min(CONCURRENCY, toFetch.length) }, () =>
      processNext(),
    );
    void Promise.all(workers).then(() => {
      refreshingRef.current = false;
    });

    return () => {
      cancelledRef.current = true;
    };
  }, [books, fetchAndCache, refreshToken, onBookEnriched]);

  // Background auto-refresh: check every 30 min for stale cached entries
  useEffect(() => {
    const INTERVAL_MS = 30 * 60 * 1000;
    const bgRefreshingRef = { current: false };

    const timer = setInterval(async () => {
      if (bgRefreshingRef.current || refreshingRef.current) return;
      bgRefreshingRef.current = true;

      try {
        const cache = readCache();
        const stale: Book[] = [];
        for (const book of books) {
          const entry = cache[book.id];
          if (!entry) continue; // not yet fetched, skip
          if (Date.now() - entry.fetchedAt > cacheMaxAge(entry)) {
            stale.push(book);
          }
        }

        if (stale.length === 0) return;

        // Refresh stale entries with concurrency limit, preserving existing data
        const CONCURRENCY = 2;
        let idx = 0;

        async function processNext(): Promise<void> {
          while (idx < stale.length) {
            const current = idx++;
            const book = stale[current];
            setAvailMap((prev) => ({
              ...prev,
              [book.id]: { ...prev[book.id], status: "loading" },
            }));
            const result = await fetchAndCache(book);
            setAvailMap((prev) => ({ ...prev, [book.id]: result }));
          }
        }

        const workers = Array.from({ length: Math.min(CONCURRENCY, stale.length) }, () =>
          processNext(),
        );
        await Promise.all(workers);
      } finally {
        bgRefreshingRef.current = false;
      }
    }, INTERVAL_MS);

    return () => clearInterval(timer);
  }, [books, fetchAndCache]);

  const oldestFetchedAt = (() => {
    let oldest: number | null = null;
    for (const s of Object.values(availMap)) {
      if (s.fetchedAt && (oldest === null || s.fetchedAt < oldest)) {
        oldest = s.fetchedAt;
      }
    }
    return oldest;
  })();

  return {
    availMap,
    checkedCount,
    loadingCount,
    totalBooks,
    refreshBook,
    refreshAll,
    oldestFetchedAt,
    enrichmentProgress,
  };
}
