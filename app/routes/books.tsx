import { usePostHog } from "@posthog/react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { getBooks, getLibraries, type Book, type LibraryConfig } from "~/lib/storage";
import { findBookInLibrary, type BookAvailability } from "~/lib/libby";
import { Logo } from "~/components/logo";

export function meta() {
  return [{ title: "Your Books | ShelfCheck" }];
}

// --- Cache utilities ---

const CACHE_KEY = "shelfcheck:availability";
const MIN_CACHE_MS = 2 * 60 * 60 * 1000; // 2 hours
const DEFAULT_CACHE_MS = 24 * 60 * 60 * 1000; // 24 hours

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

function cacheMaxAge(entry: CachedEntry): number {
  // Find the shortest estimated wait across all results
  let minWaitDays: number | null = null;
  for (const r of entry.data.results) {
    const days = r.availability.estimatedWaitDays;
    if (days != null && (minWaitDays === null || days < minWaitDays)) {
      minWaitDays = days;
    }
  }

  if (minWaitDays == null || entry.data.results.length === 0) {
    return DEFAULT_CACHE_MS;
  }

  // Half-life of the shortest wait, minimum 2 hours
  const halfLifeMs = (minWaitDays / 2) * 24 * 60 * 60 * 1000;
  return Math.max(halfLifeMs, MIN_CACHE_MS);
}

function getCached(bookId: string): CachedEntry | null {
  const cache = readCache();
  const entry = cache[bookId];
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > cacheMaxAge(entry)) return null;
  return entry;
}

function setCached(bookId: string, data: BookAvailability) {
  const cache = readCache();
  cache[bookId] = { data, fetchedAt: Date.now() };
  writeCache(cache);
}

// --- Availability hook with caching ---

type AvailStatus = "cached" | "pending" | "loading" | "done";

interface BookAvailState {
  status: AvailStatus;
  data?: BookAvailability;
  fetchedAt?: number;
}

function useAvailabilityChecker(books: Book[], libraries: LibraryConfig[]) {
  const [availMap, setAvailMap] = useState<Record<string, BookAvailState>>({});
  const [refreshToken, setRefreshToken] = useState(0);
  const refreshingRef = useRef(false);

  const totalBooks = books.length;
  const checkedCount = Object.values(availMap).filter(
    (s) => s.status === "done" || s.status === "cached"
  ).length;
  const loadingCount = Object.values(availMap).filter(
    (s) => s.status === "loading"
  ).length;

  const fetchAndCache = useCallback(
    async (book: Book): Promise<BookAvailState> => {
      try {
        // Search across all libraries and merge results
        const allResults = await Promise.all(
          libraries.map((lib) =>
            findBookInLibrary(lib.key, book.title, book.author).catch(
              () =>
                ({
                  bookTitle: book.title,
                  bookAuthor: book.author,
                  results: [],
                }) as BookAvailability
            )
          )
        );

        const merged: BookAvailability = {
          bookTitle: book.title,
          bookAuthor: book.author,
          results: [],
        };

        for (const result of allResults) {
          merged.results.push(...result.results);
          if (!merged.coverUrl && result.coverUrl) {
            merged.coverUrl = result.coverUrl;
          }
          if (!merged.seriesInfo && result.seriesInfo) {
            merged.seriesInfo = result.seriesInfo;
          }
        }

        // Deduplicate by library+mediaItem (keep unique per library)
        const seen = new Set<string>();
        merged.results = merged.results.filter((r) => {
          const key = `${r.libraryKey}:${r.mediaItem.id}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        merged.results.sort((a, b) => b.matchScore - a.matchScore);
        setCached(book.id, merged);
        return { status: "done", data: merged, fetchedAt: Date.now() };
      } catch {
        const fallback: BookAvailability = {
          bookTitle: book.title,
          bookAuthor: book.author,
          results: [],
        };
        return { status: "done", data: fallback, fetchedAt: Date.now() };
      }
    },
    [libraries]
  );

  const refreshBook = useCallback(
    async (book: Book) => {
      setAvailMap((prev) => ({
        ...prev,
        [book.id]: { ...prev[book.id], status: "loading" },
      }));
      const result = await fetchAndCache(book);
      setAvailMap((prev) => ({ ...prev, [book.id]: result }));
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

    const initial: Record<string, BookAvailState> = {};
    const toFetch: Book[] = [];

    for (const book of books) {
      if (forceRefresh) {
        initial[book.id] = { status: "pending" };
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

    const CONCURRENCY = 4;
    let idx = 0;

    async function processNext(): Promise<void> {
      while (idx < toFetch.length) {
        const current = idx++;
        const book = toFetch[current];
        setAvailMap((prev) => ({
          ...prev,
          [book.id]: { ...prev[book.id], status: "loading" },
        }));
        const result = await fetchAndCache(book);
        setAvailMap((prev) => ({ ...prev, [book.id]: result }));
      }
    }

    const workers = Array.from(
      { length: Math.min(CONCURRENCY, toFetch.length) },
      () => processNext()
    );
    void Promise.all(workers).then(() => {
      refreshingRef.current = false;
    });
  }, [books, fetchAndCache, refreshToken]);

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

const SOON_THRESHOLD_DAYS = 14;

type BookCategory = "available" | "soon" | "waiting" | "not_found" | "pending";

function categorizeBook(state?: BookAvailState): BookCategory {
  if (!state || state.status === "pending" || state.status === "loading") return "pending";
  if (!state.data || state.data.results.length === 0) return "not_found";
  if (state.data.results.some((r) => r.availability.isAvailable)) return "available";
  const minWait = Math.min(
    ...state.data.results
      .map((r) => r.availability.estimatedWaitDays ?? Infinity)
  );
  if (minWait <= SOON_THRESHOLD_DAYS) return "soon";
  return "waiting";
}

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

function FormatIcon({ type }: { type: string }) {
  if (type === "ebook") {
    return (
      <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
      </svg>
    );
  }
  return (
    <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
    </svg>
  );
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

function LibraryIcon({ libraryKey, libraries, className }: { libraryKey: string; libraries: LibraryConfig[]; className?: string }) {
  const lib = libraries.find((l) => l.key === libraryKey);
  if (lib?.logoUrl) {
    return (
      <img
        src={lib.logoUrl}
        alt={lib.name}
        title={lib.name}
        className={className ?? "h-4 w-auto rounded bg-white p-0.5 flex-shrink-0"}
      />
    );
  }
  const initial = lib?.name?.[0]?.toUpperCase() ?? "L";
  return (
    <span
      title={lib?.name ?? libraryKey}
      className="inline-flex items-center justify-center w-5 h-5 rounded-sm bg-gray-200 dark:bg-gray-600 text-[10px] font-bold text-gray-600 dark:text-gray-300 flex-shrink-0"
    >
      {initial}
    </span>
  );
}

function LibraryName({ libraryKey, libraries }: { libraryKey: string; libraries: LibraryConfig[] }) {
  const lib = libraries.find((l) => l.key === libraryKey);
  return <>{lib?.name ?? libraryKey}</>;
}

function EtaBadge({ days }: { days?: number }) {
  if (days == null) return <span className="text-gray-400 dark:text-gray-500">&mdash;</span>;
  let color = "text-red-500 dark:text-red-400";
  if (days <= 7) color = "text-green-500 dark:text-green-400";
  else if (days <= SOON_THRESHOLD_DAYS) color = "text-blue-500 dark:text-blue-400";
  else if (days <= 60) color = "text-yellow-500 dark:text-yellow-400";
  return <span className={`font-medium ${color}`}>~{days}d</span>;
}

type FormatFilter = "all" | "ebook" | "audiobook";

function categorizeBookWithFormat(state: BookAvailState | undefined, formatFilter: FormatFilter): BookCategory {
  if (!state || state.status === "pending" || state.status === "loading") return "pending";
  const results = formatFilter === "all"
    ? (state.data?.results ?? [])
    : (state.data?.results ?? []).filter((r) => r.formatType === formatFilter);
  if (results.length === 0) return "not_found";
  if (results.some((r) => r.availability.isAvailable)) return "available";
  const minWait = Math.min(...results.map((r) => r.availability.estimatedWaitDays ?? Infinity));
  if (minWait <= SOON_THRESHOLD_DAYS) return "soon";
  return "waiting";
}

function SummaryStats({
  available,
  soon,
  waiting,
  notFound,
  activeCategory,
  onToggleCategory,
}: {
  available: number;
  soon: number;
  waiting: number;
  notFound: number;
  activeCategory: BookCategory | null;
  onToggleCategory: (cat: BookCategory) => void;
}) {
  const stats: { key: BookCategory; label: string; count: number; bg: string; activeBg: string; border: string; activeBorder: string; text: string }[] = [
    { key: "available", label: "AVAILABLE", count: available, bg: "bg-green-500/10 dark:bg-green-500/20", activeBg: "bg-green-500/25 dark:bg-green-500/35", border: "border-green-500/30", activeBorder: "border-green-500", text: "text-green-500" },
    { key: "soon", label: "SOON", count: soon, bg: "bg-blue-500/10 dark:bg-blue-500/20", activeBg: "bg-blue-500/25 dark:bg-blue-500/35", border: "border-blue-500/30", activeBorder: "border-blue-500", text: "text-blue-500" },
    { key: "waiting", label: "WAITING", count: waiting, bg: "bg-yellow-500/10 dark:bg-yellow-500/20", activeBg: "bg-yellow-500/25 dark:bg-yellow-500/35", border: "border-yellow-500/30", activeBorder: "border-yellow-500", text: "text-yellow-500" },
    { key: "not_found", label: "NOT FOUND", count: notFound, bg: "bg-red-500/10 dark:bg-red-500/20", activeBg: "bg-red-500/25 dark:bg-red-500/35", border: "border-red-500/30", activeBorder: "border-red-500", text: "text-red-500" },
  ];

  return (
    <div className="grid grid-cols-4 gap-2 sm:gap-3 mb-4">
      {stats.map((s) => {
        const isActive = activeCategory === s.key;
        return (
          <button
            key={s.key}
            onClick={() => onToggleCategory(s.key)}
            className={`flex flex-col items-center py-3 rounded-xl border transition-all cursor-pointer ${
              isActive ? `${s.activeBg} ${s.activeBorder} ring-1 ring-inset ring-current/10` : `${s.bg} ${s.border}`
            } ${!isActive && activeCategory ? "opacity-50" : ""}`}
          >
            <span className={`text-2xl sm:text-3xl font-bold ${s.text}`}>{s.count}</span>
            <span className="text-[10px] sm:text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              {s.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function FormatFilterBar({
  active,
  onToggle,
}: {
  active: FormatFilter;
  onToggle: (f: FormatFilter) => void;
}) {
  const options: { key: FormatFilter; label: string; icon: React.ReactNode }[] = [
    { key: "all", label: "All", icon: null },
    {
      key: "ebook",
      label: "eBooks",
      icon: <FormatIcon type="ebook" />,
    },
    {
      key: "audiobook",
      label: "Audiobooks",
      icon: <FormatIcon type="audiobook" />,
    },
  ];

  return (
    <div className="flex items-center gap-2 mb-6">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onToggle(o.key)}
          className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${
            active === o.key
              ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900 border-transparent"
              : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
          }`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function BookCard({
  book,
  state,
  libraries,
  formatFilter,
  onRefresh,
  onLibbyClick,
}: {
  book: Book;
  state: BookAvailState;
  libraries: LibraryConfig[];
  formatFilter: FormatFilter;
  onRefresh: () => void;
  onLibbyClick: (bookTitle: string, formatType: string, isAvailable: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const category = categorizeBookWithFormat(state, formatFilter);
  const isLoading = state.status === "pending" || state.status === "loading";
  const isDone = state.status === "done" || state.status === "cached";
  const rawResults = state.data?.results ?? [];
  const filteredRaw = formatFilter === "all" ? rawResults : rawResults.filter((r) => r.formatType === formatFilter);
  const availableCount = filteredRaw.filter((r) => r.availability.isAvailable).length;

  // Sort by ETA: available first (0), then by estimatedWaitDays ascending
  const results = useMemo(() => {
    return [...filteredRaw].sort((a, b) => {
      const etaA = a.availability.isAvailable ? -1 : (a.availability.estimatedWaitDays ?? Infinity);
      const etaB = b.availability.isAvailable ? -1 : (b.availability.estimatedWaitDays ?? Infinity);
      return etaA - etaB;
    });
  }, [filteredRaw]);

  const MAX_VISIBLE = 4;
  const hasMore = results.length > MAX_VISIBLE;
  const visibleResults = showAll ? results : results.slice(0, MAX_VISIBLE);

  const borderColor =
    category === "available"
      ? "border-green-500"
      : category === "soon"
        ? "border-blue-400"
        : category === "waiting"
          ? "border-yellow-400"
          : category === "pending"
            ? "border-blue-300 dark:border-blue-700"
            : "border-gray-200 dark:border-gray-700";

  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm border-l-4 transition-colors duration-300 overflow-hidden ${borderColor}`}
    >
      {/* Book header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-4 p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
      >
        {(state.data?.coverUrl || book.imageUrl) && (
          <img
            src={state.data?.coverUrl ?? book.imageUrl}
            alt={book.title}
            className="w-12 h-[4.5rem] object-cover rounded-md flex-shrink-0"
          />
        )}
        <div className="flex-1 min-w-0">
          <span className="font-semibold text-gray-900 dark:text-white line-clamp-1">
            {book.title}
          </span>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {book.author || "Unknown Author"}
          </p>
          {state.data?.seriesInfo && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              Book {state.data.seriesInfo.readingOrder} in{" "}
              <span className="italic">{state.data.seriesInfo.seriesName}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isLoading && (
            <span className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full">
              <span className="inline-block w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              Checking
            </span>
          )}
          {isDone && category === "available" && (
            <span className="text-sm px-3 py-1.5 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded-full font-medium">
              {availableCount} ready
            </span>
          )}
          {isDone && category === "soon" && (
            <span className="text-sm px-3 py-1.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-full font-medium">
              Soon
            </span>
          )}
          {isDone && category === "waiting" && (
            <span className="text-sm px-3 py-1.5 bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 rounded-full font-medium">
              Waitlist
            </span>
          )}
          {isDone && category === "not_found" && (
            <span className="text-sm px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-full">
              Not found
            </span>
          )}
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded detail table */}
      {expanded && isDone && results.length > 0 && (
        <div className="border-t border-gray-100 dark:border-gray-700">
          {/* Table header */}
          <div className="grid grid-cols-[24px_24px_1fr_1fr_1fr] sm:grid-cols-[1fr_140px_70px_70px_60px] gap-x-2 sm:gap-x-3 px-4 py-2 text-[10px] sm:text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
            <span><span className="hidden sm:inline">Library</span></span>
            <span><span className="hidden sm:inline">Format</span></span>
            <span className="text-right">Holds</span>
            <span className="text-right">Copies</span>
            <span className="text-right">ETA</span>
          </div>
          {/* Table rows */}
          {visibleResults.map((r) => {
            const preferredKey = libraries.find((l) => l.key === r.libraryKey)?.preferredKey ?? r.libraryKey;
            const url = libbyTitleUrl(preferredKey, r.mediaItem.id);
            return (
              <a
                key={`${r.libraryKey}-${r.mediaItem.id}`}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => onLibbyClick(book.title, r.formatType, r.availability.isAvailable)}
                className="grid grid-cols-[24px_24px_1fr_1fr_1fr] sm:grid-cols-[1fr_140px_70px_70px_60px] gap-x-2 sm:gap-x-3 px-4 py-2.5 items-center border-t border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors group"
              >
                <span className="flex items-center gap-2 min-w-0 text-sm text-gray-700 dark:text-gray-300">
                  <LibraryIcon libraryKey={r.libraryKey} libraries={libraries} />
                  <span className="hidden sm:inline truncate"><LibraryName libraryKey={r.libraryKey} libraries={libraries} /></span>
                </span>
                <span className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
                  <FormatIcon type={r.formatType} />
                  <span className="hidden sm:inline">
                    <span>{formatType(r.formatType)}</span>
                    {r.mediaItem.publisher?.name && (
                      <span className="block text-[10px] text-gray-400 dark:text-gray-500 truncate">
                        {r.mediaItem.publisher.name}
                        {r.mediaItem.publishDate && ` (${r.mediaItem.publishDate.slice(0, 4)})`}
                      </span>
                    )}
                  </span>
                </span>
                <span className={`text-right text-sm tabular-nums ${r.availability.numberOfHolds > 100 ? "text-red-500 dark:text-red-400" : "text-gray-700 dark:text-gray-300"}`}>
                  {r.availability.isAvailable ? (
                    <span className="text-green-600 dark:text-green-400 font-medium">0</span>
                  ) : (
                    r.availability.numberOfHolds
                  )}
                </span>
                <span className="text-right text-sm text-gray-700 dark:text-gray-300 tabular-nums">
                  {r.availability.copiesAvailable}/{r.availability.copiesOwned}
                </span>
                <span className="text-right text-sm">
                  {r.availability.isAvailable ? (
                    <span className="text-green-600 dark:text-green-400 font-medium">Now</span>
                  ) : (
                    <EtaBadge days={r.availability.estimatedWaitDays} />
                  )}
                </span>
              </a>
            );
          })}
          {/* Show more / less toggle */}
          {hasMore && (
            <button
              onClick={() => setShowAll((s) => !s)}
              className="w-full text-center py-2 border-t border-gray-50 dark:border-gray-700/50 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              {showAll ? "Show less" : `Show ${results.length - MAX_VISIBLE} more`}
            </button>
          )}
          {/* Refresh row */}
          <div className="flex items-center justify-end px-4 py-2 border-t border-gray-50 dark:border-gray-700/50">
            <button
              onClick={onRefresh}
              title={state.fetchedAt ? `Last checked ${timeAgo(state.fetchedAt)}` : "Refresh"}
              className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {state.fetchedAt && <span>{timeAgo(state.fetchedAt)}</span>}
            </button>
          </div>
        </div>
      )}

      {/* Not found - show refresh */}
      {expanded && isDone && results.length === 0 && (
        <div className="flex items-center justify-end px-4 py-2 border-t border-gray-100 dark:border-gray-700">
          <button
            onClick={onRefresh}
            title={state.fetchedAt ? `Last checked ${timeAgo(state.fetchedAt)}` : "Refresh"}
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {state.fetchedAt && <span>{timeAgo(state.fetchedAt)}</span>}
          </button>
        </div>
      )}
    </div>
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

export default function Books() {
  const posthog = usePostHog();
  const navigate = useNavigate();
  const [books, setLocalBooks] = useState<Book[]>([]);
  const [libraries, setLocalLibraries] = useState<LibraryConfig[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const storedBooks = getBooks();
    const storedLibraries = getLibraries();
    if (storedBooks.length === 0 || storedLibraries.length === 0) {
      navigate("/setup", { replace: true });
      return;
    }
    setLocalBooks(storedBooks);
    setLocalLibraries(storedLibraries);
    setReady(true);
    posthog?.capture("books_page_viewed", {
      book_count: storedBooks.length,
      library_count: storedLibraries.length,
      book_source: storedBooks[0]?.source,
    });
  }, [navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));

  // Filters
  const [categoryFilter, setCategoryFilter] = useState<BookCategory | null>(null);
  const [formatFilter, setFormatFilter] = useState<FormatFilter>("all");

  const {
    availMap,
    checkedCount,
    loadingCount,
    totalBooks,
    refreshBook,
    refreshAll,
    oldestFetchedAt,
  } = useAvailabilityChecker(ready ? books : [], libraries);

  const categoryCounts = useMemo(() => {
    const counts = { available: 0, soon: 0, waiting: 0, not_found: 0 };
    for (const book of books) {
      const cat = categorizeBookWithFormat(availMap[book.id], formatFilter);
      if (cat !== "pending" && cat in counts) {
        counts[cat as keyof typeof counts]++;
      }
    }
    return counts;
  }, [books, availMap, formatFilter]);

  const categoryScore = (cat: BookCategory) => {
    switch (cat) {
      case "available": return 4;
      case "soon": return 3;
      case "waiting": return 2;
      case "not_found": return 1;
      default: return 0;
    }
  };

  const sortedAndFilteredBooks = useMemo(() => {
    let filtered = [...books];

    // Apply category filter
    if (categoryFilter) {
      filtered = filtered.filter(
        (b) => categorizeBookWithFormat(availMap[b.id], formatFilter) === categoryFilter
      );
    }

    // Sort by category score then title
    filtered.sort((a, b) => {
      const scoreA = categoryScore(categorizeBookWithFormat(availMap[a.id], formatFilter));
      const scoreB = categoryScore(categorizeBookWithFormat(availMap[b.id], formatFilter));
      if (scoreB !== scoreA) return scoreB - scoreA;
      return a.title.localeCompare(b.title);
    });

    return filtered;
  }, [books, availMap, categoryFilter, formatFilter]);

  const totalPages = Math.ceil(sortedAndFilteredBooks.length / PAGE_SIZE);
  const paginatedBooks = sortedAndFilteredBooks.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE
  );

  const goToPage = (p: number) => {
    setSearchParams({ page: String(p) });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleToggleCategory = (cat: BookCategory) => {
    const newFilter = categoryFilter === cat ? null : cat;
    setCategoryFilter(newFilter);
    setSearchParams({ page: "1" });
    posthog?.capture("category_filter_toggled", {
      category: cat,
      active: newFilter === cat,
    });
  };

  const handleToggleFormat = (f: FormatFilter) => {
    setFormatFilter(f);
    setSearchParams({ page: "1" });
    posthog?.capture("format_filter_toggled", { format: f });
  };

  const handleRefreshAll = () => {
    posthog?.capture("all_books_refreshed", {
      book_count: books.length,
      library_count: libraries.length,
    });
    refreshAll();
  };

  const handleLibbyClick = (bookTitle: string, formatType: string, isAvailable: boolean) => {
    posthog?.capture("libby_link_clicked", {
      book_title: bookTitle,
      format_type: formatType,
      is_available: isAvailable,
    });
  };

  if (!ready) return null;

  return (
    <main className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 dark:from-gray-950 dark:to-gray-900 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Logo className="w-9 h-9" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                  ShelfCheck
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {books.length} books &middot; {libraries.length} {libraries.length === 1 ? "library" : "libraries"}
                </p>
              </div>
            </div>
            <Link
              to="/setup"
              className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              Settings
            </Link>
          </div>
          {oldestFetchedAt && checkedCount === totalBooks && loadingCount === 0 && (
            <div className="flex items-center gap-2 mt-2 ml-12">
              <span className="text-xs text-gray-400 dark:text-gray-500">
                Updated {timeAgo(oldestFetchedAt)}
              </span>
              <span className="text-gray-300 dark:text-gray-600">·</span>
              <button
                onClick={handleRefreshAll}
                className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
              >
                Refresh All
              </button>
            </div>
          )}
        </div>

        {books.length === 0 && (
          <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl shadow-lg">
            <p className="text-gray-500 dark:text-gray-400">
              No books loaded. Upload a reading list to get started.
            </p>
            <Link
              to="/setup"
              className="text-amber-600 hover:text-amber-700 underline mt-2 inline-block"
            >
              Go to Setup
            </Link>
          </div>
        )}

        {books.length > 0 && checkedCount < totalBooks && (
          <ProgressBar
            checked={checkedCount}
            total={totalBooks}
            loading={loadingCount}
            oldestFetchedAt={oldestFetchedAt}
            onRefreshAll={handleRefreshAll}
          />
        )}

        {books.length > 0 && checkedCount > 0 && (
          <>
            <SummaryStats
              available={categoryCounts.available}
              soon={categoryCounts.soon}
              waiting={categoryCounts.waiting}
              notFound={categoryCounts.not_found}
              activeCategory={categoryFilter}
              onToggleCategory={handleToggleCategory}
            />
            <FormatFilterBar active={formatFilter} onToggle={handleToggleFormat} />
          </>
        )}

        {sortedAndFilteredBooks.length === 0 && books.length > 0 && checkedCount > 0 && (
          <div className="text-center py-8 bg-white dark:bg-gray-800 rounded-xl shadow-sm">
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              No books match the current filters.
            </p>
            <button
              onClick={() => { setCategoryFilter(null); setFormatFilter("all"); }}
              className="mt-2 text-amber-600 hover:text-amber-700 underline text-sm"
            >
              Clear filters
            </button>
          </div>
        )}

        <div className="space-y-3">
          {paginatedBooks.map((book) => {
            const state = availMap[book.id] ?? { status: "pending" as const };
            return (
              <BookCard
                key={book.id}
                book={book}
                state={state}
                libraries={libraries}
                formatFilter={formatFilter}
                onRefresh={() => refreshBook(book)}
                onLibbyClick={handleLibbyClick}
              />
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
