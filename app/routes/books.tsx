import { redirect, Link, useSearchParams } from "react-router";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { Route } from "./+types/books";
import { getSession } from "~/lib/session.server";
import { fetchAllWantToRead, type UserBook } from "~/lib/hardcover.server";
import type { BookAvailability } from "~/lib/libby.server";

export function meta() {
  return [{ title: "Your Books | HardcoverLibby" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await getSession(request);
  const hardcoverKey = session.get("hardcoverApiKey") as string;
  const libraryKey = session.get("libraryKey") as string;
  const libraryPreferredKey = (session.get("libraryPreferredKey") as string) ?? libraryKey;
  const libraryName = (session.get("libraryName") as string) ?? libraryKey;

  if (!hardcoverKey || !libraryKey) {
    throw redirect("/setup");
  }

  let userBooks: UserBook[] = [];
  let fetchError: string | null = null;

  try {
    userBooks = await fetchAllWantToRead(hardcoverKey);
  } catch (e) {
    fetchError = e instanceof Error ? e.message : "Failed to fetch books";
  }

  return {
    userBooks,
    libraryName,
    libraryKey,
    libraryPreferredKey,
    fetchError,
  };
}

// --- Cache utilities ---

const CACHE_KEY = "hardcoverlibby:availability";
const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours

interface CachedEntry {
  data: BookAvailability;
  fetchedAt: number;
}

function readCache(): Record<string, CachedEntry> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, CachedEntry>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore quota errors
  }
}

function getCached(bookId: number): CachedEntry | null {
  const cache = readCache();
  const entry = cache[String(bookId)];
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_MAX_AGE_MS) return null;
  return entry;
}

function setCached(bookId: number, data: BookAvailability) {
  const cache = readCache();
  cache[String(bookId)] = { data, fetchedAt: Date.now() };
  writeCache(cache);
}

// --- Availability hook with caching ---

type AvailStatus = "cached" | "pending" | "loading" | "done";

interface BookAvailState {
  status: AvailStatus;
  data?: BookAvailability;
  fetchedAt?: number;
}

function useAvailabilityChecker(userBooks: UserBook[], libraryKey: string) {
  const [availMap, setAvailMap] = useState<Record<number, BookAvailState>>({});
  const [refreshToken, setRefreshToken] = useState(0);
  const refreshingRef = useRef(false);

  const uniqueBookIds = useMemo(
    () => new Set(userBooks.map((ub) => ub.book.id)),
    [userBooks]
  );
  const totalBooks = uniqueBookIds.size;
  const checkedCount = Object.values(availMap).filter(
    (s) => s.status === "done" || s.status === "cached"
  ).length;
  const loadingCount = Object.values(availMap).filter(
    (s) => s.status === "loading"
  ).length;

  const fetchAndCache = useCallback(
    async (ub: UserBook): Promise<BookAvailState> => {
      const author = ub.book.contributions?.[0]?.author?.name ?? "";
      const params = new URLSearchParams({ title: ub.book.title, author });

      try {
        const res = await fetch(`/api/availability?${params}`);
        const data: BookAvailability = await res.json();
        setCached(ub.book.id, data);
        return { status: "done", data, fetchedAt: Date.now() };
      } catch {
        const fallback: BookAvailability = {
          bookTitle: ub.book.title,
          bookAuthor: author,
          results: [],
        };
        return { status: "done", data: fallback, fetchedAt: Date.now() };
      }
    },
    []
  );

  const refreshBook = useCallback(
    async (ub: UserBook) => {
      setAvailMap((prev) => ({
        ...prev,
        [ub.book.id]: { ...prev[ub.book.id], status: "loading" },
      }));
      const result = await fetchAndCache(ub);
      setAvailMap((prev) => ({ ...prev, [ub.book.id]: result }));
    },
    [fetchAndCache]
  );

  const refreshAll = useCallback(() => {
    if (refreshingRef.current) return;
    setRefreshToken((t) => t + 1);
  }, []);

  useEffect(() => {
    refreshingRef.current = true;

    const forceRefresh = refreshToken > 0;

    const initial: Record<number, BookAvailState> = {};
    const toFetch: UserBook[] = [];

    for (const ub of userBooks) {
      if (forceRefresh) {
        initial[ub.book.id] = { status: "pending" };
        toFetch.push(ub);
        continue;
      }
      const cached = getCached(ub.book.id);
      if (cached) {
        initial[ub.book.id] = {
          status: "cached",
          data: cached.data,
          fetchedAt: cached.fetchedAt,
        };
      } else {
        initial[ub.book.id] = { status: "pending" };
        toFetch.push(ub);
      }
    }
    setAvailMap(initial);

    if (toFetch.length === 0) {
      refreshingRef.current = false;
      return;
    }

    const CONCURRENCY = 4;
    let idx = 0;

    async function processNext(): Promise<void> {
      while (idx < toFetch.length) {
        const current = idx++;
        const ub = toFetch[current];
        setAvailMap((prev) => ({
          ...prev,
          [ub.book.id]: { ...prev[ub.book.id], status: "loading" },
        }));
        const result = await fetchAndCache(ub);
        setAvailMap((prev) => ({ ...prev, [ub.book.id]: result }));
      }
    }

    const workers = Array.from(
      { length: Math.min(CONCURRENCY, toFetch.length) },
      () => processNext()
    );
    void Promise.all(workers).then(() => {
      refreshingRef.current = false;
    });
  }, [userBooks, fetchAndCache, refreshToken]);

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
  };
}

// --- UI Components ---

function libbyTitleUrl(libraryKey: string, titleId: string) {
  return `https://libbyapp.com/library/${libraryKey}/everything/page-1/${titleId}`;
}

function formatType(type: string): string {
  switch (type) {
    case "ebook":
      return "eBook";
    case "audiobook":
      return "Audiobook";
    default:
      return type;
  }
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function AvailabilityBadge({
  state,
  libraryKey,
  onRefresh,
}: {
  state: BookAvailState;
  libraryKey: string;
  onRefresh: () => void;
}) {
  if (state.status === "pending" || state.status === "loading") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full">
        <span className="inline-block w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
        Checking...
      </span>
    );
  }

  const avail = state.data;

  if (!avail || avail.results.length === 0) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-full">
          Not found
        </span>
        <RefreshButton fetchedAt={state.fetchedAt} onRefresh={onRefresh} />
      </div>
    );
  }

  const available = avail.results.filter((r) => r.availability.isAvailable);
  const waitlist = avail.results.filter((r) => !r.availability.isAvailable);

  return (
    <div className="flex flex-wrap items-center gap-1">
      {available.map((r) => (
        <a
          key={r.mediaItem.id}
          href={libbyTitleUrl(libraryKey, r.mediaItem.id)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded-full hover:bg-green-200 dark:hover:bg-green-900/60 transition-colors"
        >
          {formatType(r.formatType)} available &rarr;
        </a>
      ))}
      {waitlist.map((r) => (
        <a
          key={r.mediaItem.id}
          href={libbyTitleUrl(libraryKey, r.mediaItem.id)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 rounded-full hover:bg-yellow-200 dark:hover:bg-yellow-900/60 transition-colors"
        >
          {formatType(r.formatType)} — {r.availability.numberOfHolds} hold{r.availability.numberOfHolds !== 1 ? "s" : ""}, {r.availability.copiesAvailable} of {r.availability.copiesOwned} copies
          {r.availability.estimatedWaitDays
            ? ` (~${r.availability.estimatedWaitDays}d wait)`
            : ""} &rarr;
        </a>
      ))}
      <RefreshButton fetchedAt={state.fetchedAt} onRefresh={onRefresh} />
    </div>
  );
}

function RefreshButton({
  fetchedAt,
  onRefresh,
}: {
  fetchedAt?: number;
  onRefresh: () => void;
}) {
  return (
    <button
      onClick={onRefresh}
      title={fetchedAt ? `Last checked ${timeAgo(fetchedAt)}` : "Refresh"}
      className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
    >
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
      {fetchedAt && (
        <span>{timeAgo(fetchedAt)}</span>
      )}
    </button>
  );
}

function ProgressBar({
  checked,
  total,
  loading,
  oldestFetchedAt,
  onRefreshAll,
}: {
  checked: number;
  total: number;
  loading: number;
  oldestFetchedAt: number | null;
  onRefreshAll: () => void;
}) {
  if (total === 0) return null;
  const pct = Math.round((checked / total) * 100);
  const done = checked === total && loading === 0;

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm text-gray-600 dark:text-gray-400">
          {done ? (
            <>
              Checked all {total} books
              {oldestFetchedAt && (
                <span className="ml-1 text-gray-400 dark:text-gray-500">
                  (oldest: {timeAgo(oldestFetchedAt)})
                </span>
              )}
            </>
          ) : (
            `Checking availability... ${checked} / ${total}`
          )}
        </span>
        <div className="flex items-center gap-2">
          {done && (
            <button
              onClick={onRefreshAll}
              className="text-xs px-2 py-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              Refresh All
            </button>
          )}
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {pct}%
          </span>
        </div>
      </div>
      {!done && (
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300 bg-amber-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

// --- Main component ---

const PAGE_SIZE = 20;

export default function Books({ loaderData }: Route.ComponentProps) {
  const {
    userBooks,
    libraryName,
    libraryKey,
    libraryPreferredKey,
    fetchError,
  } = loaderData;

  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));

  const {
    availMap,
    checkedCount,
    loadingCount,
    totalBooks,
    refreshBook,
    refreshAll,
    oldestFetchedAt,
  } = useAvailabilityChecker(userBooks, libraryKey);

  // Sort ALL books globally by status then title
  const scoreFor = (s?: BookAvailState) => {
    if (!s?.data) return 0;
    if (s.data.results.some((r) => r.availability.isAvailable)) return 2;
    if (s.data.results.length > 0) return 1;
    return 0;
  };

  const sortedBooks = useMemo(() => {
    return [...userBooks].sort((a, b) => {
      const scoreA = scoreFor(availMap[a.book.id]);
      const scoreB = scoreFor(availMap[b.book.id]);
      if (scoreB !== scoreA) return scoreB - scoreA;
      return a.book.title.localeCompare(b.book.title);
    });
  }, [userBooks, availMap]);

  // Client-side pagination over the sorted list
  const totalPages = Math.ceil(sortedBooks.length / PAGE_SIZE);
  const paginatedBooks = sortedBooks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const goToPage = (p: number) => {
    setSearchParams({ page: String(p) });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 dark:from-gray-950 dark:to-gray-900 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Want to Read
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {userBooks.length} books &middot; Availability at{" "}
              <span className="font-medium">{libraryName}</span>
            </p>
          </div>
          <Link
            to="/setup"
            className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Settings
          </Link>
        </div>

        {fetchError && (
          <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4 text-red-700 dark:text-red-400 mb-6">
            {fetchError}
          </div>
        )}

        {userBooks.length === 0 && !fetchError && (
          <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl shadow-lg">
            <p className="text-gray-500 dark:text-gray-400">
              No books on your "Want to Read" shelf yet.
            </p>
            <a
              href="https://hardcover.app"
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-600 hover:text-amber-700 underline mt-2 inline-block"
            >
              Browse Hardcover to add some
            </a>
          </div>
        )}

        {userBooks.length > 0 && (
          <ProgressBar
            checked={checkedCount}
            total={totalBooks}
            loading={loadingCount}
            oldestFetchedAt={oldestFetchedAt}
            onRefreshAll={refreshAll}
          />
        )}

        <div className="space-y-3">
          {paginatedBooks.map((ub) => {
            const author =
              ub.book.contributions?.[0]?.author?.name ?? "Unknown Author";
            const state = availMap[ub.book.id] ?? { status: "pending" as const };
            const hasAvailable =
              (state.status === "done" || state.status === "cached") &&
              state.data?.results.some((r) => r.availability.isAvailable);
            const hasWaitlist =
              (state.status === "done" || state.status === "cached") &&
              (state.data?.results.length ?? 0) > 0 &&
              !hasAvailable;

            return (
              <div
                key={ub.id}
                className={`flex gap-4 bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border-l-4 transition-colors duration-300 ${
                  hasAvailable
                    ? "border-green-500"
                    : hasWaitlist
                      ? "border-yellow-400"
                      : state.status === "pending" || state.status === "loading"
                        ? "border-blue-300 dark:border-blue-700"
                        : "border-gray-200 dark:border-gray-700"
                }`}
              >
                {ub.book.image?.url && (
                  <img
                    src={ub.book.image.url}
                    alt={ub.book.title}
                    className="w-16 h-24 object-cover rounded-md flex-shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <a
                    href={`https://hardcover.app/books/${ub.book.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-gray-900 dark:text-white hover:text-amber-600 dark:hover:text-amber-400 line-clamp-1"
                  >
                    {ub.book.title}
                  </a>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {author}
                  </p>
                  <div className="mt-2">
                    <AvailabilityBadge
                      state={state}
                      libraryKey={libraryPreferredKey}
                      onRefresh={() => refreshBook(ub)}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-8">
            <button
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1}
              className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages}
              className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
