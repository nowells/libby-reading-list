import { useMemo, useState } from "react";
import type { BookAvailabilityResult } from "~/lib/libby";
import type { LibraryConfig } from "~/lib/storage";
import { FormatIcon } from "~/components/format-icon";
import { LibraryIcon, LibraryName } from "~/components/library-icon";
import { libbyTitleUrl } from "../lib/utils";
import { EtaBadge } from "./eta-badge";

interface AvailabilityTableProps {
  /** Book title forwarded to onLibbyClick — pure analytics, optional. */
  bookTitle: string;
  /** Pre-filtered (and ideally pre-sorted) availability results. */
  results: BookAvailabilityResult[];
  /** All configured libraries. The "Library" column hides when there's only one. */
  libraries: LibraryConfig[];
  /** Per-row click analytics (e.g. /books "libby_link_clicked" event). */
  onLibbyClick?: (bookTitle: string, formatType: string, isAvailable: boolean) => void;
  /**
   * When set, only the first N rows render with a Show more / less toggle
   * underneath. Leave undefined to show every row (book detail page).
   */
  maxVisible?: number;
}

/**
 * Grid table of Libby editions for one work.
 *
 * Shared by /books (per-card, collapsed past 4 rows) and /book/:workId
 * (full detail). Both sites want the same columns — format icon, library
 * (only when more than one configured), publisher (year), holds, copies,
 * ETA — and the same hide-library-column-when-single trick to give
 * publisher more room.
 */
export function AvailabilityTable({
  bookTitle,
  results,
  libraries,
  onLibbyClick,
  maxVisible,
}: AvailabilityTableProps) {
  const [showAll, setShowAll] = useState(false);
  const multiLibrary = libraries.length > 1;
  const limit = maxVisible ?? Number.POSITIVE_INFINITY;
  const hasMore = !showAll && results.length > limit;
  const visibleResults = useMemo(
    () => (showAll ? results : results.slice(0, limit)),
    [results, showAll, limit],
  );

  // Each grid template trades the Library column for more Publisher room
  // when there's only one library configured — the column header would
  // otherwise be a redundant single-row label.
  const gridCols = multiLibrary
    ? "grid-cols-[28px_40px_1fr_1fr_1fr] sm:grid-cols-[24px_1fr_1fr_70px_70px_60px]"
    : "grid-cols-[28px_1fr_1fr_1fr] sm:grid-cols-[24px_1fr_70px_70px_60px]";

  return (
    <>
      <div
        className={`grid gap-x-2 sm:gap-x-3 px-4 py-2 text-[10px] sm:text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider ${gridCols}`}
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
            onClick={() => onLibbyClick?.(bookTitle, r.formatType, r.availability.isAvailable)}
            className={`grid gap-x-2 sm:gap-x-3 px-4 py-2.5 items-center border-t border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors group ${gridCols}`}
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
          onClick={() => setShowAll(true)}
          className="w-full text-center py-2 border-t border-gray-50 dark:border-gray-700/50 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          Show {results.length - limit} more
        </button>
      )}
      {showAll && maxVisible != null && results.length > maxVisible && (
        <button
          onClick={() => setShowAll(false)}
          className="w-full text-center py-2 border-t border-gray-50 dark:border-gray-700/50 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          Show less
        </button>
      )}
    </>
  );
}
