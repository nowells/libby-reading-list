import { useState, useMemo } from "react";
import type { AuthorEntry, LibraryConfig } from "~/lib/storage";
import { FormatIcon } from "~/components/format-icon";
import { LibraryIcon, LibraryName } from "~/components/library-icon";
import { EtaBadge } from "~/routes/books/components/eta-badge";
import { libbyTitleUrl } from "~/routes/books/lib/utils";
import type { AuthorAvailState, AuthorBookResult } from "../hooks/use-author-availability";

function WorkRow({
  work,
  libraries,
  multiLibrary,
  formatFilter = "all",
}: {
  work: AuthorBookResult;
  libraries: LibraryConfig[];
  multiLibrary: boolean;
  formatFilter?: "all" | "ebook" | "audiobook";
}) {
  const [expanded, setExpanded] = useState(false);
  const filteredResults =
    formatFilter === "all"
      ? work.libbyResults
      : work.libbyResults.filter((r) => r.formatType === formatFilter);
  const hasResults = filteredResults.length > 0;
  const isAvailable = filteredResults.some((r) => r.availability.isAvailable);
  const bestEta = hasResults
    ? Math.min(
        ...filteredResults.map((r) =>
          r.availability.isAvailable ? 0 : (r.availability.estimatedWaitDays ?? Infinity),
        ),
      )
    : undefined;

  return (
    <div className="border-t border-gray-100 dark:border-gray-700/50">
      <button
        onClick={() => hasResults && setExpanded((e) => !e)}
        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left ${hasResults ? "hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer" : "cursor-default"} transition-colors`}
      >
        {/* Cover thumbnail */}
        {work.coverId ? (
          <img
            src={`https://covers.openlibrary.org/b/id/${work.coverId}-S.jpg`}
            alt=""
            className="w-8 h-12 object-cover rounded flex-shrink-0"
          />
        ) : (
          <div className="w-8 h-12 bg-gray-100 dark:bg-gray-700 rounded flex-shrink-0 flex items-center justify-center">
            <svg
              className="w-4 h-4 text-gray-400"
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
        )}

        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-gray-900 dark:text-white line-clamp-1">
            {work.title}
          </span>
          {work.firstPublishYear && (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {work.firstPublishYear}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {hasResults && (
            <>
              {/* Format icons */}
              <span className="flex gap-1 text-gray-400 dark:text-gray-500">
                {filteredResults.some((r) => r.formatType === "ebook") && (
                  <span className="[&_svg]:w-4 [&_svg]:h-4">
                    <FormatIcon type="ebook" />
                  </span>
                )}
                {filteredResults.some((r) => r.formatType === "audiobook") && (
                  <span className="[&_svg]:w-4 [&_svg]:h-4">
                    <FormatIcon type="audiobook" />
                  </span>
                )}
              </span>
              {/* ETA */}
              <span className="text-sm">
                {isAvailable ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium text-xs px-2 py-0.5 bg-emerald-50 dark:bg-emerald-900/30 rounded-full">
                    Now
                  </span>
                ) : bestEta != null && bestEta < Infinity ? (
                  <EtaBadge days={bestEta} />
                ) : null}
              </span>
            </>
          )}
          {!hasResults && (
            <span className="text-xs text-gray-400 dark:text-gray-500">Not in library</span>
          )}
          {hasResults && (
            <svg
              className={`w-3.5 h-3.5 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </div>
      </button>

      {/* Expanded: show individual Libby results */}
      {expanded && hasResults && (
        <div className="bg-gray-50/50 dark:bg-gray-800/50">
          {filteredResults.map((r) => {
            const preferredKey =
              libraries.find((l) => l.key === r.libraryKey)?.preferredKey ?? r.libraryKey;
            const url = libbyTitleUrl(preferredKey, r.mediaItem.id);
            return (
              <a
                key={`${r.libraryKey}-${r.mediaItem.id}`}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className={`grid gap-x-2 px-4 py-2 items-center border-t border-gray-100/50 dark:border-gray-700/30 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors text-sm ${
                  multiLibrary
                    ? "grid-cols-[24px_1fr_60px_60px_50px]"
                    : "grid-cols-[24px_60px_60px_50px]"
                }`}
              >
                <span className="text-gray-500 dark:text-gray-400">
                  <FormatIcon type={r.formatType} />
                </span>
                {multiLibrary && (
                  <span className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400 min-w-0 truncate">
                    <LibraryIcon libraryKey={r.libraryKey} libraries={libraries} />
                    <span className="hidden sm:inline truncate text-xs">
                      <LibraryName libraryKey={r.libraryKey} libraries={libraries} />
                    </span>
                  </span>
                )}
                <span
                  className={`text-right tabular-nums text-xs ${r.availability.numberOfHolds > 100 ? "text-red-500" : "text-gray-600 dark:text-gray-400"}`}
                >
                  {r.availability.isAvailable ? (
                    <span className="text-emerald-600 dark:text-emerald-400">0 holds</span>
                  ) : (
                    `${r.availability.numberOfHolds} holds`
                  )}
                </span>
                <span className="text-right text-xs text-gray-600 dark:text-gray-400 tabular-nums">
                  {r.availability.copiesAvailable}/{r.availability.copiesOwned}
                </span>
                <span className="text-right text-xs">
                  {r.availability.isAvailable ? (
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">Now</span>
                  ) : (
                    <EtaBadge days={r.availability.estimatedWaitDays} />
                  )}
                </span>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

export type AuthorFormatFilter = "all" | "ebook" | "audiobook";

/** Categorize a work by its best availability (with optional format filter). */
export function categorizeWork(
  w: AuthorBookResult,
  formatFilter: AuthorFormatFilter = "all",
): "available" | "soon" | "waiting" | "not_found" {
  const results =
    formatFilter === "all"
      ? w.libbyResults
      : w.libbyResults.filter((r) => r.formatType === formatFilter);
  if (results.length === 0) return "not_found";
  if (results.some((r) => r.availability.isAvailable)) return "available";
  const bestEta = Math.min(...results.map((r) => r.availability.estimatedWaitDays ?? Infinity));
  if (bestEta <= 14) return "soon";
  return "waiting";
}

export const CATEGORY_ORDER = { available: 0, soon: 1, waiting: 2, not_found: 3 };

/** Best availability category across all works for an author. */
export function bestAuthorCategory(
  works: AuthorBookResult[],
  ff: AuthorFormatFilter,
): "available" | "soon" | "waiting" | "not_found" {
  let best: "available" | "soon" | "waiting" | "not_found" = "not_found";
  for (const w of works) {
    const cat = categorizeWork(w, ff);
    if (CATEGORY_ORDER[cat] < CATEGORY_ORDER[best]) best = cat;
    if (best === "available") break;
  }
  return best;
}

/** Best ETA across a work's libby results (0 for available, Infinity for not found). */
function bestEtaDays(w: AuthorBookResult, ff: AuthorFormatFilter): number {
  const results = ff === "all" ? w.libbyResults : w.libbyResults.filter((r) => r.formatType === ff);
  if (results.length === 0) return Infinity;
  return Math.min(
    ...results.map((r) =>
      r.availability.isAvailable ? 0 : (r.availability.estimatedWaitDays ?? Infinity),
    ),
  );
}

export type AuthorCategoryFilter = "available" | "soon" | "waiting" | "not_found" | null;

export function AuthorCard({
  author,
  state,
  libraries,
  formatFilter = "all",
  categoryFilter = null,
  onRefresh,
  onRemove,
}: {
  author: AuthorEntry;
  state: AuthorAvailState;
  libraries: LibraryConfig[];
  formatFilter?: AuthorFormatFilter;
  categoryFilter?: AuthorCategoryFilter;
  onRefresh: () => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const multiLibrary = libraries.length > 1;

  // Sort works by availability category, then ETA within category, then title
  // When a category filter is active, only show matching works
  const sortedWorks = useMemo(() => {
    let works = [...state.works];
    if (categoryFilter) {
      works = works.filter((w) => categorizeWork(w, formatFilter) === categoryFilter);
    }
    return works.sort((a, b) => {
      const catDiff =
        CATEGORY_ORDER[categorizeWork(a, formatFilter)] -
        CATEGORY_ORDER[categorizeWork(b, formatFilter)];
      if (catDiff !== 0) return catDiff;
      // Within same category, sort by best ETA ascending
      const etaDiff = bestEtaDays(a, formatFilter) - bestEtaDays(b, formatFilter);
      if (etaDiff !== 0) return etaDiff;
      return a.title.localeCompare(b.title);
    });
  }, [state.works, formatFilter, categoryFilter]);

  const filteredCount = categoryFilter
    ? sortedWorks.length
    : sortedWorks.filter((w) => categorizeWork(w, formatFilter) === "available").length;
  const inLibraryCount = categoryFilter
    ? sortedWorks.length
    : sortedWorks.filter((w) => categorizeWork(w, formatFilter) !== "not_found").length;
  const totalWorks = categoryFilter ? sortedWorks.length : state.works.length;

  // Badge text/color based on active category filter
  const badgeConfig = (() => {
    switch (categoryFilter) {
      case "soon":
        return {
          label: "soon",
          pill: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300",

        };
      case "waiting":
        return {
          label: "waiting",
          pill: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",

        };
      case "not_found":
        return {
          label: "not found",
          pill: "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300",

        };
      default:
        return {
          label: "available",
          pill: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",

        };
    }
  })();

  const MAX_VISIBLE = 10;
  const visibleWorks = showAll ? sortedWorks : sortedWorks.slice(0, MAX_VISIBLE);
  const hasMore = sortedWorks.length > MAX_VISIBLE;

  const isLoading = state.status === "loading-works" || state.status === "loading-availability";

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border-l-4 border-purple-400 dark:border-purple-500 overflow-hidden">
      {/* Author header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-4 p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
      >
        {/* Author icon */}
        <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center flex-shrink-0">
          <svg
            className="w-6 h-6 text-purple-600 dark:text-purple-400"
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
        </div>

        <div className="flex-1 min-w-0">
          <span className="font-semibold text-gray-900 dark:text-white">
            {state.resolvedName ?? author.name}
          </span>
          {state.status === "done" && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {totalWorks} works &middot; {inLibraryCount} in library
            </p>
          )}
          {isLoading && state.progress && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Checking availability... {state.progress.done}/{state.progress.total}
            </p>
          )}
          {state.status === "loading-works" && !state.progress && (
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading works...</p>
          )}
          {state.status === "error" && (
            <p className="text-sm text-red-500 dark:text-red-400">{state.error}</p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {isLoading && (
            <span className="inline-block w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
          )}
          {state.status === "done" && filteredCount > 0 && (
            <span className={`hidden sm:inline-flex text-sm px-3 py-1.5 rounded-full font-medium ${badgeConfig.pill}`}>
              {filteredCount} {badgeConfig.label}
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

      {/* Loading progress bar */}
      {isLoading && state.progress && expanded && (
        <div className="px-4 pb-2">
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
            <div
              className="bg-purple-500 h-1.5 rounded-full transition-all"
              style={{ width: `${(state.progress.done / state.progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Works list */}
      {expanded && state.works.length > 0 && (
        <>
          {visibleWorks.map((work) => (
            <WorkRow
              key={work.olWorkKey}
              work={work}
              libraries={libraries}
              multiLibrary={multiLibrary}
              formatFilter={formatFilter}
            />
          ))}
          {hasMore && (
            <button
              onClick={() => setShowAll((s) => !s)}
              className="w-full text-center py-2 border-t border-gray-100 dark:border-gray-700/50 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              {showAll ? "Show less" : `Show ${sortedWorks.length - MAX_VISIBLE} more works`}
            </button>
          )}
        </>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100 dark:border-gray-700">
        <div className="flex items-center gap-3">
          {state.olKey && (
            <a
              href={`https://openlibrary.org/authors/${state.olKey}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M4 4h6a3 3 0 013 3v13a2 2 0 00-2-2H4V4zm16 0h-6a3 3 0 00-3 3v13a2 2 0 012-2h7V4z" />
              </svg>
              Open Library
            </a>
          )}
          <button
            onClick={onRemove}
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
          >
            <svg
              className="w-3 h-3"
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
        <button
          onClick={onRefresh}
          className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          <svg
            className={`w-3 h-3 ${isLoading ? "animate-spin" : ""}`}
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
          Refresh
        </button>
      </div>
    </div>
  );
}
