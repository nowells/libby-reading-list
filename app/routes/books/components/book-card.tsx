import { useState, useMemo, useRef, useEffect } from "react";
import { Link } from "react-router";
import type { Book, LibraryConfig, ShelfStatus } from "~/lib/storage";
import { FormatIcon } from "~/components/format-icon";
import { LibraryIcon, LibraryName } from "~/components/library-icon";
import { CoverImage } from "~/components/cover-image";
import { SourceLinks } from "~/components/source-links";
import { StarRating } from "~/components/star-rating";
import { SHELF_STATUSES, statusLabel, effectiveStatus } from "~/components/shelf-status";
import { EtaBadge } from "./eta-badge";
import {
  categorizeBookWithFormat,
  type BookAvailState,
  type FormatFilter,
} from "../lib/categorize";
import { timeAgo, libbyTitleUrl, formatAudiobookDuration } from "../lib/utils";

const STATUS_PILL_CLASSES: Record<ShelfStatus, string> = {
  wantToRead:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800",
  reading:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-800",
  finished:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
  abandoned:
    "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border-gray-200 dark:border-gray-700",
};

function StatusDropdown({
  status,
  onChange,
}: {
  status: ShelfStatus;
  onChange: (next: ShelfStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Change status"
        aria-expanded={open}
        className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border ${STATUS_PILL_CLASSES[status]}`}
      >
        {statusLabel(status)}
        <svg
          className="w-3 h-3 opacity-60"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg py-1 min-w-[140px]">
          {SHELF_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                onChange(s);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                s === status
                  ? "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 font-medium"
                  : "text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600"
              }`}
            >
              {statusLabel(s)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
  onMarkRead?: () => void;
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
        aria-label="More actions"
        className="inline-flex items-center justify-center w-7 h-7 rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
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
          {onMarkRead && (
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
          )}
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

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString();
}

interface BookCardProps {
  book: Book;
  /**
   * Libby availability state. Pass `{ status: "pending" }` when not applicable
   * (e.g. for a `finished` book where we don't fetch availability) — the card
   * suppresses the availability table when there is no data.
   */
  state: BookAvailState;
  libraries: LibraryConfig[];
  formatFilter: FormatFilter;
  onRefresh?: () => void;
  onLibbyClick?: (bookTitle: string, formatType: string, isAvailable: boolean) => void;
  onEdit?: () => void;
  onFind?: () => void;
  onRemove: () => void;
  onMarkRead?: () => void;
  onFollowAuthor?: () => void;
  onStatusChange?: (next: ShelfStatus) => void;
  isRead: boolean;
  isAuthorFollowed: boolean;
  /**
   * When true, render the Libby availability table inside the card. Defaults
   * to true so existing callers (the want-to-read view) keep their behavior.
   * Set to false for cards rendered under non-want-to-read filters where
   * library availability is not the focus.
   */
  showAvailability?: boolean;
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
  onStatusChange,
  isRead,
  isAuthorFollowed,
  showAvailability = true,
}: BookCardProps) {
  const [showAll, setShowAll] = useState(false);
  const multiLibrary = libraries.length > 1;
  const hasData = !!state.data;
  const category = categorizeBookWithFormat(state, formatFilter);
  const isLoading = (state.status === "pending" || state.status === "loading") && !hasData;
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

  const status = effectiveStatus(book);
  const isWantToRead = status === "wantToRead";
  const renderAvailability = showAvailability && isWantToRead;

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

  // Left border tints by availability category for want-to-read books, by
  // status for everything else. The reading-history-style cards don't have
  // a meaningful availability state to convey, so the status pill carries
  // that signal instead.
  const borderColor = isRead
    ? "border-gray-300 dark:border-gray-600"
    : renderAvailability && category === "available"
      ? "border-emerald-500"
      : renderAvailability && category === "soon"
        ? "border-blue-400"
        : renderAvailability && category === "waiting"
          ? "border-amber-400"
          : renderAvailability && category === "pending"
            ? "border-blue-300 dark:border-blue-700"
            : status === "reading"
              ? "border-blue-400"
              : status === "finished"
                ? "border-emerald-400"
                : status === "abandoned"
                  ? "border-gray-300 dark:border-gray-600"
                  : "border-gray-200 dark:border-gray-700";

  const coverSrc =
    state.data?.coverUrl ??
    book.imageUrl ??
    (book.isbn13 ? `https://covers.openlibrary.org/b/isbn/${book.isbn13}-M.jpg` : undefined);

  const displayTitle = book.canonicalTitle ?? book.title;
  const displayAuthor = book.canonicalAuthor ?? book.author ?? "Unknown Author";

  const cover = <CoverImage src={coverSrc} alt={book.title} size="md" />;

  return (
    <li
      className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm border-l-4 transition-colors duration-300 ${borderColor} ${isRead ? "opacity-60" : ""}`}
    >
      {/* Card header — hardcover-style horizontal layout */}
      <div className="flex items-start gap-4 p-4">
        {book.workId ? (
          <Link to={`/book/${book.workId}`} aria-label={`View details for ${book.title}`}>
            {cover}
          </Link>
        ) : (
          cover
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              {book.workId ? (
                <Link
                  to={`/book/${book.workId}`}
                  className="block font-semibold text-base text-gray-900 dark:text-white line-clamp-2 hover:text-amber-600 dark:hover:text-amber-400"
                >
                  {displayTitle}
                </Link>
              ) : (
                <h3 className="font-semibold text-base text-gray-900 dark:text-white line-clamp-2">
                  {displayTitle}
                </h3>
              )}
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                by {displayAuthor}
                {book.firstPublishYear ? (
                  <span className="text-gray-400 dark:text-gray-500">
                    {" "}
                    · {book.firstPublishYear}
                  </span>
                ) : null}
              </p>
              {state.data?.seriesInfo && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                  Book {state.data.seriesInfo.readingOrder} in{" "}
                  <span className="italic">{state.data.seriesInfo.seriesName}</span>
                </p>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
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

          {/* Status / rating / reading-history row */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {onStatusChange ? (
              <StatusDropdown status={status} onChange={onStatusChange} />
            ) : (
              <span
                className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border ${STATUS_PILL_CLASSES[status]}`}
              >
                {statusLabel(status)}
              </span>
            )}
            {/* Legacy ReadBookEntry indicator — independent from status. */}
            {isRead && status !== "finished" && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
                <svg
                  className="w-3 h-3"
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
            {book.rating !== undefined && book.rating > 0 && (
              <StarRating value={book.rating} readOnly size={14} />
            )}
            {!renderAvailability && book.finishedAt && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Finished {fmtDate(book.finishedAt)}
              </span>
            )}
            {!renderAvailability && !book.finishedAt && book.startedAt && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Started {fmtDate(book.startedAt)}
              </span>
            )}
            {/* Availability summary chip — only when we're rendering availability */}
            {renderAvailability && !isRead && isLoading && (
              <span className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                <span className="inline-block w-2.5 h-2.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                Checking
              </span>
            )}
            {renderAvailability && !isRead && isDone && category === "available" && (
              <span className="inline-flex text-xs px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 rounded-full font-medium">
                {availableCount} ready
              </span>
            )}
            {renderAvailability && !isRead && isDone && category === "soon" && (
              <span className="inline-flex text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-full font-medium">
                Soon
              </span>
            )}
            {renderAvailability && !isRead && isDone && category === "waiting" && (
              <span className="inline-flex text-xs px-2 py-0.5 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded-full font-medium">
                Waitlist
              </span>
            )}
            {renderAvailability && !isRead && isDone && category === "not_found" && (
              <span className="inline-flex text-xs px-2 py-0.5 bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 rounded-full">
                Not found
              </span>
            )}
            {audiobookDuration && (
              <span className="inline-flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 [&_svg]:w-3.5 [&_svg]:h-3.5">
                <FormatIcon type="audiobook" />
                {audiobookDuration}
              </span>
            )}
          </div>

          {/* Note preview */}
          {book.note && (
            <p className="mt-2 text-xs text-gray-600 dark:text-gray-300 line-clamp-2 whitespace-pre-wrap">
              {book.note}
            </p>
          )}
        </div>
      </div>

      {/* Libby availability detail table — only for want-to-read */}
      {renderAvailability && isDone && results.length > 0 && (
        <div className="border-t border-gray-100 dark:border-gray-700">
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
                onClick={() => onLibbyClick?.(book.title, r.formatType, r.availability.isAvailable)}
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
          {hasMore && (
            <button
              onClick={() => setShowAll((s) => !s)}
              className="w-full text-center py-2 border-t border-gray-50 dark:border-gray-700/50 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              {showAll ? "Show less" : `Show ${results.length - MAX_VISIBLE} more`}
            </button>
          )}
          <div className="flex items-center justify-between px-4 py-2 border-t border-gray-50 dark:border-gray-700/50">
            <div className="flex items-center gap-3">
              <SourceLinks book={book} />
            </div>
            {onRefresh && (
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
            )}
          </div>
        </div>
      )}

      {/* Want-to-read but no Libby results found */}
      {renderAvailability && isDone && results.length === 0 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <SourceLinks book={book} />
          </div>
          {onRefresh && (
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
          )}
        </div>
      )}

      {/* Footer for non-want-to-read cards: source links only (no Libby) */}
      {!renderAvailability && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <SourceLinks book={book} />
          </div>
        </div>
      )}
    </li>
  );
}
