import { useState, useMemo, useRef, useEffect } from "react";
import type { Book, LibraryConfig } from "~/lib/storage";
import { FormatIcon } from "~/components/format-icon";
import { LibraryIcon, LibraryName } from "~/components/library-icon";
import { CoverImage } from "~/components/cover-image";
import { SourceLinks } from "~/components/source-links";
import { EtaBadge } from "./eta-badge";
import {
  categorizeBookWithFormat,
  type BookAvailState,
  type FormatFilter,
} from "../lib/categorize";
import { timeAgo, libbyTitleUrl, formatAudiobookDuration } from "../lib/utils";

function ActionMenu({
  onEdit,
  onFind,
  onMarkRead,
  onRemove,
  onFollowAuthor,
  isRead,
  isAuthorFollowed,
}: {
  onEdit?: () => void;
  onFind?: () => void;
  onMarkRead: () => void;
  onRemove: () => void;
  onFollowAuthor?: () => void;
  isRead: boolean;
  isAuthorFollowed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="12" cy="19" r="1.5" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-gray-700 rounded-lg shadow-lg border border-gray-200 dark:border-gray-600 py-1 z-50">
          {onEdit && (
            <button
              onClick={() => {
                onEdit();
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors text-gray-700 dark:text-gray-200"
            >
              <svg
                className="w-4 h-4 flex-shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125"
                />
              </svg>
              Edit details
            </button>
          )}
          {onFind && (
            <button
              onClick={() => {
                onFind();
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors text-amber-600 dark:text-amber-400"
            >
              <svg
                className="w-4 h-4 flex-shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
                />
              </svg>
              Find match
            </button>
          )}
          <button
            onClick={() => {
              onMarkRead();
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors text-gray-700 dark:text-gray-200"
          >
            <svg
              className="w-4 h-4 flex-shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            {isRead ? "Mark as Unread" : "Mark as Read"}
          </button>
          {onFollowAuthor && !isAuthorFollowed && (
            <button
              onClick={() => {
                onFollowAuthor();
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors text-gray-700 dark:text-gray-200"
            >
              <svg
                className="w-4 h-4 flex-shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
                />
              </svg>
              Follow Author
            </button>
          )}
          <button
            onClick={() => {
              onRemove();
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors text-red-600 dark:text-red-400"
          >
            <svg
              className="w-4 h-4 flex-shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

export function BookCard({
  book,
  state,
  libraries,
  formatFilter,
  onRefresh,
  onLibbyClick,
  onEdit,
  onFind,
  onRemove,
  onMarkRead,
  onFollowAuthor,
  isRead,
  isAuthorFollowed,
}: {
  book: Book;
  state: BookAvailState;
  libraries: LibraryConfig[];
  formatFilter: FormatFilter;
  onRefresh: () => void;
  onLibbyClick: (bookTitle: string, formatType: string, isAvailable: boolean) => void;
  onEdit?: () => void;
  onFind?: () => void;
  onRemove: () => void;
  onMarkRead: () => void;
  onFollowAuthor?: () => void;
  isRead: boolean;
  isAuthorFollowed: boolean;
}) {
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

  const borderColor = isRead
    ? "border-gray-300 dark:border-gray-600"
    : category === "available"
      ? "border-emerald-500"
      : category === "soon"
        ? "border-blue-400"
        : category === "waiting"
          ? "border-amber-400"
          : category === "pending"
            ? "border-blue-300 dark:border-blue-700"
            : "border-gray-200 dark:border-gray-700";

  // Suppress unused variable warning — kept for potential future use
  void isRefreshing;

  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm border-l-4 transition-colors duration-300 ${borderColor} ${isRead ? "opacity-60" : ""}`}
    >
      {/* Book header */}
      <div className="flex items-center gap-4 p-4">
        <CoverImage
          src={
            state.data?.coverUrl ??
            book.imageUrl ??
            (book.isbn13 ? `https://covers.openlibrary.org/b/isbn/${book.isbn13}-M.jpg` : undefined)
          }
          alt={book.title}
        />
        <div className="flex-1 min-w-0">
          <span className="font-semibold text-gray-900 dark:text-white line-clamp-1">
            {book.canonicalTitle ?? book.title}
          </span>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {book.canonicalAuthor ?? book.author ?? "Unknown Author"}
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
          {isRead && (
            <span className="inline-flex items-center gap-1 text-sm px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-full">
              <svg
                className="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              Read
            </span>
          )}
          {!isRead && isLoading && (
            <span className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full">
              <span className="inline-block w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              Checking
            </span>
          )}
          {!isRead && isDone && category === "available" && (
            <span className="hidden sm:inline-flex text-sm px-3 py-1.5 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 rounded-full font-medium">
              {availableCount} ready
            </span>
          )}
          {!isRead && isDone && category === "soon" && (
            <span className="hidden sm:inline-flex text-sm px-3 py-1.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-full font-medium">
              Soon
            </span>
          )}
          {!isRead && isDone && category === "waiting" && (
            <span className="hidden sm:inline-flex text-sm px-3 py-1.5 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded-full font-medium">
              Waitlist
            </span>
          )}
          {!isRead && isDone && category === "not_found" && (
            <span className="hidden sm:inline-flex text-sm px-3 py-1.5 bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 rounded-full">
              Not found
            </span>
          )}
          <ActionMenu
            onEdit={onEdit}
            onFind={onFind}
            onMarkRead={onMarkRead}
            onRemove={onRemove}
            onFollowAuthor={onFollowAuthor}
            isRead={isRead}
            isAuthorFollowed={isAuthorFollowed}
          />
        </div>
      </div>

      {/* Detail table */}
      {isDone && results.length > 0 && (
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
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">0</span>
                  ) : (
                    r.availability.numberOfHolds
                  )}
                </span>
                <span className="text-right text-sm text-gray-700 dark:text-gray-300 tabular-nums">
                  {r.availability.copiesAvailable}/{r.availability.copiesOwned}
                </span>
                <span className="text-right text-sm">
                  {r.availability.isAvailable ? (
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">Now</span>
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
              <SourceLinks book={book} />
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

      {/* Not found - show footer */}
      {isDone && results.length === 0 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <SourceLinks book={book} />
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
