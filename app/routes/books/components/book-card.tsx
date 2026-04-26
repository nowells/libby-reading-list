import { useState, useMemo, useRef, useEffect } from "react";
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

function CoverImage({ src, alt }: { src?: string; alt: string }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className="w-12 h-[4.5rem] rounded-md flex-shrink-0 bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
        <svg
          className="w-6 h-6 text-gray-400 dark:text-gray-500"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
          />
        </svg>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className="w-12 h-[4.5rem] object-cover rounded-md flex-shrink-0"
      onError={() => setFailed(true)}
    />
  );
}

const EXTERNAL_LINK_CLASS =
  "inline-flex items-center gap-1 text-xs text-gray-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors";

function PrimarySourceLink({ book }: { book: Book }) {
  if (book.source === "storygraph") {
    return (
      <a
        href={
          book.sourceUrl ??
          `https://app.thestorygraph.com/browse?search_term=${encodeURIComponent(`${book.title} ${book.author}`)}`
        }
        target="_blank"
        rel="noopener noreferrer"
        className={EXTERNAL_LINK_CLASS}
        title="View on The StoryGraph"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 3h18v18H3V3zm2 2v14h14V5H5zm2 10h2v2H7v-2zm4-4h2v6h-2v-6zm4-4h2v10h-2V7z" />
        </svg>
        The StoryGraph
      </a>
    );
  }

  if (book.source === "lyndi") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-400">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h5v7h7v9H6z" />
        </svg>
        Lyndi CSV
      </span>
    );
  }

  if (book.source === "bookhive") {
    return (
      <a
        href={
          book.sourceUrl ??
          `https://bookhive.buzz/search?q=${encodeURIComponent(`${book.title} ${book.author}`)}`
        }
        target="_blank"
        rel="noopener noreferrer"
        className={EXTERNAL_LINK_CLASS}
        title="View on Bookhive"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2l3 6 6 .9-4.5 4.2 1 6.4L12 16.6 6.5 19.5l1-6.4L3 8.9 9 8l3-6z" />
        </svg>
        Bookhive
      </a>
    );
  }

  return (
    <>
      {(book.source === "goodreads" || book.source === "unknown") && (
        <a
          href={
            book.sourceUrl ??
            `https://www.goodreads.com/search?q=${encodeURIComponent(`${book.title} ${book.author}`)}`
          }
          target="_blank"
          rel="noopener noreferrer"
          className={EXTERNAL_LINK_CLASS}
          title="View on Goodreads"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.525 15.977V.49h-2.059v2.906h-.064c-.211-.455-.481-.891-.842-1.307-.36-.412-.767-.761-1.243-1.043C14.837.763 14.275.63 13.634.63c-1.17 0-2.137.369-2.91 1.107-.773.738-1.353 1.708-1.737 2.91-.385 1.198-.58 2.498-.58 3.905 0 1.387.2 2.682.586 3.876.39 1.199.966 2.16 1.731 2.904.77.738 1.737 1.109 2.91 1.109.596 0 1.148-.127 1.66-.381.51-.254.942-.58 1.296-.984.352-.398.616-.818.79-1.26h.064v2.197c0 1.553-.32 2.742-.96 3.56-.641.822-1.566 1.23-2.773 1.23-.682 0-1.27-.14-1.77-.424a3.013 3.013 0 01-1.178-1.107 3.368 3.368 0 01-.497-1.473h-2.165c.08.941.365 1.775.854 2.504.49.729 1.133 1.299 1.93 1.713.8.418 1.717.625 2.747.625 1.322 0 2.398-.287 3.223-.863.828-.576 1.436-1.373 1.826-2.391.39-1.018.588-2.191.588-3.525zM13.737 14.41c-.86 0-1.563-.26-2.107-.781-.547-.52-.95-1.209-1.213-2.07-.264-.858-.394-1.79-.394-2.791 0-.988.13-1.916.394-2.783.268-.87.671-1.57 1.213-2.1.544-.533 1.247-.798 2.107-.798.88 0 1.59.27 2.133.81.547.537.95 1.24 1.213 2.107.264.862.396 1.79.396 2.783 0 .983-.13 1.9-.39 2.756-.26.861-.664 1.555-1.213 2.084-.548.525-1.26.783-2.14.783z" />
          </svg>
          Goodreads
        </a>
      )}
      {(book.source === "hardcover" || book.source === "unknown") && (
        <a
          href={
            book.sourceUrl ?? `https://hardcover.app/search?q=${encodeURIComponent(book.title)}`
          }
          target="_blank"
          rel="noopener noreferrer"
          className={EXTERNAL_LINK_CLASS}
          title="View on Hardcover"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H6zm1 2h10v7l-3-2-3 2V4H7z" />
          </svg>
          Hardcover
        </a>
      )}
    </>
  );
}

function SourceLinks({ book }: { book: Book }) {
  if (book.manual) return null;
  return (
    <>
      <PrimarySourceLink book={book} />
      {book.workId && (
        <a
          href={`https://openlibrary.org/works/${book.workId}`}
          target="_blank"
          rel="noopener noreferrer"
          className={EXTERNAL_LINK_CLASS}
          title="View on Open Library"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 4h6a3 3 0 013 3v13a2 2 0 00-2-2H4V4zm16 0h-6a3 3 0 00-3 3v13a2 2 0 012-2h7V4z" />
          </svg>
          Open Library
        </a>
      )}
    </>
  );
}

function ActionMenu({
  onEdit,
  onMarkRead,
  onRemove,
  onFollowAuthor,
  isRead,
  isAuthorFollowed,
}: {
  onEdit?: () => void;
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
      className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm border-l-4 transition-colors duration-300 overflow-hidden ${borderColor} ${isRead ? "opacity-60" : ""}`}
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
