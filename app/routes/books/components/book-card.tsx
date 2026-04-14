import { useState, useMemo } from "react";
import type { Book, LibraryConfig } from "~/lib/storage";
import { FormatIcon } from "~/components/format-icon";
import { LibraryIcon, LibraryName } from "~/components/library-icon";
import { EtaBadge } from "./eta-badge";
import {
  categorizeBookWithFormat,
  type BookAvailState,
  type FormatFilter,
} from "../lib/categorize";
import { timeAgo, libbyTitleUrl, formatAudiobookDuration } from "../lib/utils";

export function BookCard({
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
  const multiLibrary = libraries.length > 1;
  const hasData = !!state.data;
  const category = categorizeBookWithFormat(state, formatFilter);
  const isLoading = (state.status === "pending" || state.status === "loading") && !hasData;
  const isRefreshing = state.status === "loading" && hasData;
  const isDone =
    state.status === "done" || state.status === "cached" || (state.status === "loading" && hasData);
  const rawResults = state.data?.results ?? [];
  const filteredRaw =
    formatFilter === "all" ? rawResults : rawResults.filter((r) => r.formatType === formatFilter);
  const availableCount = filteredRaw.filter((r) => r.availability.isAvailable).length;
  const audiobookDuration = useMemo(
    () => formatAudiobookDuration(state.data?.results ?? []),
    [state.data?.results],
  );

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

  // Suppress unused variable warning — kept for potential future use
  void isRefreshing;

  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm border-l-4 transition-colors duration-300 overflow-hidden ${borderColor}`}
    >
      {/* Book header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-4 p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
      >
        {(state.data?.coverUrl || book.imageUrl || book.isbn13) && (
          <img
            src={
              state.data?.coverUrl ??
              book.imageUrl ??
              `https://covers.openlibrary.org/b/isbn/${book.isbn13}-M.jpg`
            }
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
          {audiobookDuration && (
            <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 dark:text-gray-500">
              <span className="inline-flex items-center gap-1 [&_svg]:w-3.5 [&_svg]:h-3.5">
                <FormatIcon type="audiobook" />
                {audiobookDuration}
              </span>
            </div>
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
            <span className="hidden sm:inline-flex text-sm px-3 py-1.5 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded-full font-medium">
              {availableCount} ready
            </span>
          )}
          {isDone && category === "soon" && (
            <span className="hidden sm:inline-flex text-sm px-3 py-1.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-full font-medium">
              Soon
            </span>
          )}
          {isDone && category === "waiting" && (
            <span className="hidden sm:inline-flex text-sm px-3 py-1.5 bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 rounded-full font-medium">
              Waitlist
            </span>
          )}
          {isDone && category === "not_found" && (
            <span className="hidden sm:inline-flex text-sm px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-full">
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
          <div
            className={`grid gap-x-2 sm:gap-x-3 px-4 py-2 text-[10px] sm:text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider ${
              multiLibrary
                ? "grid-cols-[28px_40px_1fr_1fr_1fr] sm:grid-cols-[24px_1fr_1fr_70px_70px_60px]"
                : "grid-cols-[28px_1fr_1fr_1fr] sm:grid-cols-[24px_1fr_70px_70px_60px]"
            }`}
          >
            <span></span>
            {multiLibrary && (
              <span>
                <span className="hidden sm:inline">Library</span>
              </span>
            )}
            <span className="hidden sm:block">Publisher</span>
            <span className="text-right">Holds</span>
            <span className="text-right">Copies</span>
            <span className="text-right">ETA</span>
          </div>
          {/* Table rows */}
          {visibleResults.map((r) => {
            const preferredKey =
              libraries.find((l) => l.key === r.libraryKey)?.preferredKey ?? r.libraryKey;
            const url = libbyTitleUrl(preferredKey, r.mediaItem.id);
            return (
              <a
                key={`${r.libraryKey}-${r.mediaItem.id}`}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => onLibbyClick(book.title, r.formatType, r.availability.isAvailable)}
                className={`grid gap-x-2 sm:gap-x-3 px-4 py-2.5 items-center border-t border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors group ${
                  multiLibrary
                    ? "grid-cols-[28px_40px_1fr_1fr_1fr] sm:grid-cols-[24px_1fr_1fr_70px_70px_60px]"
                    : "grid-cols-[28px_1fr_1fr_1fr] sm:grid-cols-[24px_1fr_70px_70px_60px]"
                }`}
              >
                <span className="flex items-center text-sm text-gray-600 dark:text-gray-400">
                  <FormatIcon type={r.formatType} />
                </span>
                {multiLibrary && (
                  <span className="flex items-center gap-2 min-w-0 text-sm text-gray-700 dark:text-gray-300">
                    <LibraryIcon libraryKey={r.libraryKey} libraries={libraries} />
                    <span className="hidden sm:inline truncate">
                      <LibraryName libraryKey={r.libraryKey} libraries={libraries} />
                    </span>
                  </span>
                )}
                <span className="hidden sm:block text-sm text-gray-600 dark:text-gray-400 truncate">
                  {r.mediaItem.publisher?.name ? (
                    <>
                      {r.mediaItem.publisher.name}
                      {r.mediaItem.publishDate && (
                        <span className="text-gray-400 dark:text-gray-500">
                          {" "}
                          ({r.mediaItem.publishDate.slice(0, 4)})
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-gray-400 dark:text-gray-500">&mdash;</span>
                  )}
                </span>
                <span
                  className={`text-right text-sm tabular-nums ${r.availability.numberOfHolds > 100 ? "text-red-500 dark:text-red-400" : "text-gray-700 dark:text-gray-300"}`}
                >
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
          {/* Footer row */}
          <div className="flex items-center justify-between px-4 py-2 border-t border-gray-50 dark:border-gray-700/50">
            <div className="flex items-center gap-3">
              {(book.source === "goodreads" || book.source === "unknown") && (
                <a
                  href={
                    book.sourceUrl ??
                    `https://www.goodreads.com/search?q=${encodeURIComponent(`${book.title} ${book.author}`)}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                  title="View on Goodreads"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M11.43 23.995c-3.608-.208-6.274-2.077-6.448-5.078.695.007 1.375-.013 2.07-.006.224 1.342 1.065 2.43 2.683 3.026 1.583.496 3.737.46 5.082-.174 1.726-.816 2.35-2.201 2.622-3.868.064-.397.076-4.89.076-4.89h-.062c-.565.852-1.256 1.534-2.078 2.05-.823.515-1.777.772-2.86.772-1.4 0-2.56-.33-3.48-.99-.92-.66-1.6-1.59-2.04-2.79-.44-1.2-.66-2.6-.66-4.19 0-1.63.24-3.08.72-4.34.48-1.26 1.2-2.25 2.16-2.97.96-.72 2.14-1.08 3.54-1.08 1.08 0 2.04.27 2.88.81.84.54 1.5 1.21 1.98 2.01h.06l.24-2.4h1.8c-.06.6-.12 1.2-.18 2.1-.06.9-.06 1.84-.06 2.82v8.14c0 1.5-.06 2.78-.18 3.84s-.42 2.02-.9 2.88c-.48.86-1.22 1.52-2.22 1.98-1 .46-2.32.69-3.96.69zm.12-7.8c1.2 0 2.19-.36 2.97-1.08.78-.72 1.35-1.68 1.71-2.88.36-1.2.54-2.5.54-3.9 0-2.28-.42-4.08-1.26-5.4-.84-1.32-2.1-1.98-3.78-1.98-1.68 0-2.94.72-3.78 2.16-.84 1.44-1.26 3.3-1.26 5.58 0 2.16.42 3.84 1.26 5.04.84 1.2 2.1 1.8 3.78 1.8z" />
                  </svg>
                  Goodreads
                </a>
              )}
              {(book.source === "hardcover" || book.source === "unknown") && (
                <a
                  href={
                    book.sourceUrl ??
                    `https://hardcover.app/search?q=${encodeURIComponent(book.title)}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                  title="View on Hardcover"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H6zm1 2h10v7l-3-2-3 2V4H7z" />
                  </svg>
                  Hardcover
                </a>
              )}
            </div>
            <button
              onClick={onRefresh}
              title={state.fetchedAt ? `Last checked ${timeAgo(state.fetchedAt)}` : "Refresh"}
              className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <svg
                className="w-3 h-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              {state.fetchedAt && <span>{timeAgo(state.fetchedAt)}</span>}
            </button>
          </div>
        </div>
      )}

      {/* Not found - show refresh */}
      {expanded && isDone && results.length === 0 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-3">
            {(book.source === "goodreads" || book.source === "unknown") && (
              <a
                href={
                  book.sourceUrl ??
                  `https://www.goodreads.com/search?q=${encodeURIComponent(`${book.title} ${book.author}`)}`
                }
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                title="View on Goodreads"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.43 23.995c-3.608-.208-6.274-2.077-6.448-5.078.695.007 1.375-.013 2.07-.006.224 1.342 1.065 2.43 2.683 3.026 1.583.496 3.737.46 5.082-.174 1.726-.816 2.35-2.201 2.622-3.868.064-.397.076-4.89.076-4.89h-.062c-.565.852-1.256 1.534-2.078 2.05-.823.515-1.777.772-2.86.772-1.4 0-2.56-.33-3.48-.99-.92-.66-1.6-1.59-2.04-2.79-.44-1.2-.66-2.6-.66-4.19 0-1.63.24-3.08.72-4.34.48-1.26 1.2-2.25 2.16-2.97.96-.72 2.14-1.08 3.54-1.08 1.08 0 2.04.27 2.88.81.84.54 1.5 1.21 1.98 2.01h.06l.24-2.4h1.8c-.06.6-.12 1.2-.18 2.1-.06.9-.06 1.84-.06 2.82v8.14c0 1.5-.06 2.78-.18 3.84s-.42 2.02-.9 2.88c-.48.86-1.22 1.52-2.22 1.98-1 .46-2.32.69-3.96.69zm.12-7.8c1.2 0 2.19-.36 2.97-1.08.78-.72 1.35-1.68 1.71-2.88.36-1.2.54-2.5.54-3.9 0-2.28-.42-4.08-1.26-5.4-.84-1.32-2.1-1.98-3.78-1.98-1.68 0-2.94.72-3.78 2.16-.84 1.44-1.26 3.3-1.26 5.58 0 2.16.42 3.84 1.26 5.04.84 1.2 2.1 1.8 3.78 1.8z" />
                </svg>
                Goodreads
              </a>
            )}
            {(book.source === "hardcover" || book.source === "unknown") && (
              <a
                href={
                  book.sourceUrl ??
                  `https://hardcover.app/search?q=${encodeURIComponent(book.title)}`
                }
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                title="View on Hardcover"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H6zm1 2h10v7l-3-2-3 2V4H7z" />
                </svg>
                Hardcover
              </a>
            )}
          </div>
          <button
            onClick={onRefresh}
            title={state.fetchedAt ? `Last checked ${timeAgo(state.fetchedAt)}` : "Refresh"}
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <svg
              className="w-3 h-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            {state.fetchedAt && <span>{timeAgo(state.fetchedAt)}</span>}
          </button>
        </div>
      )}
    </div>
  );
}
