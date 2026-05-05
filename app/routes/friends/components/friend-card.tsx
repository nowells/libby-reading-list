import { Link } from "react-router";
import type { FriendShelf } from "~/lib/atproto/friends";
import { statusTokenName } from "~/lib/atproto/lexicon";

interface FriendCardProps {
  friend: FriendShelf;
  onRefresh?: (did: string) => void;
  isRefreshing?: boolean;
}

/** Show a "stale" badge once the friend's data is older than this. */
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 1 day

function formatStaleAge(refreshedAt: number, now = Date.now()): string {
  const diffMs = Math.max(0, now - refreshedAt);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/**
 * Slim friend row: a single tappable card that navigates to
 * `/friends/:handle` for the full bookshelf view. The previous version
 * embedded an inline accordion with tabs and per-book "+ Add" buttons —
 * that's now replaced by the full per-friend detail page so friends and
 * the viewer's own shelf share one component.
 */
export function FriendCard({ friend, onRefresh, isRefreshing }: FriendCardProps) {
  const { profile, entries, refreshedAt } = friend;
  const isStale = refreshedAt != null && Date.now() - refreshedAt > STALE_THRESHOLD_MS;

  const counts = {
    wantToRead: 0,
    reading: 0,
    finished: 0,
  };
  for (const e of entries) {
    const s = statusTokenName(e.status);
    if (s === "wantToRead") counts.wantToRead++;
    else if (s === "reading") counts.reading++;
    else if (s === "finished") counts.finished++;
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="relative flex items-stretch hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
        <Link
          to={`/friends/${profile.handle}`}
          aria-label={`View ${profile.displayName ?? profile.handle}'s shelf`}
          className="flex-1 min-w-0 flex items-center gap-3 p-4"
        >
          {profile.avatar ? (
            <img
              src={profile.avatar}
              alt=""
              className="w-10 h-10 rounded-full flex-shrink-0 object-cover"
            />
          ) : (
            <div className="w-10 h-10 rounded-full flex-shrink-0 bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
              <span className="text-sm font-medium text-purple-600 dark:text-purple-400">
                {(profile.displayName ?? profile.handle)[0]?.toUpperCase()}
              </span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
              {profile.displayName ?? profile.handle}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
              @{profile.handle}
              {isStale && refreshedAt != null && (
                <>
                  {" "}
                  <span
                    className="text-amber-600 dark:text-amber-400"
                    title={`Last refresh from this friend's PDS was ${formatStaleAge(refreshedAt)}. Their server may be unreachable.`}
                  >
                    · stale, last seen {formatStaleAge(refreshedAt)}
                  </span>
                </>
              )}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
              <span>
                {entries.length} {entries.length === 1 ? "book" : "books"}
              </span>
              {counts.wantToRead > 0 && (
                <span className="text-amber-600 dark:text-amber-400">{counts.wantToRead} want</span>
              )}
              {counts.reading > 0 && (
                <span className="text-blue-600 dark:text-blue-400">{counts.reading} reading</span>
              )}
              {counts.finished > 0 && (
                <span className="text-emerald-600 dark:text-emerald-400">
                  {counts.finished} finished
                </span>
              )}
            </div>
          </div>
          <svg
            className="w-4 h-4 text-gray-400 flex-shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </Link>
        {onRefresh && (
          <button
            type="button"
            onClick={() => onRefresh(profile.did)}
            disabled={isRefreshing}
            aria-label={`Refresh ${profile.displayName ?? profile.handle}'s reading list`}
            title="Refresh reading list"
            className="flex-shrink-0 self-center mr-2 p-2 rounded-full text-gray-400 hover:text-purple-600 dark:hover:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/20 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            <svg
              className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`}
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
          </button>
        )}
      </div>
    </div>
  );
}
