import { timeAgo } from "../lib/utils";

export function ProgressBar({
  checked,
  total,
  loading,
  oldestFetchedAt,
  onRefreshAll,
  enrichmentProgress,
}: {
  checked: number;
  total: number;
  loading: number;
  oldestFetchedAt: number | null;
  onRefreshAll: () => void;
  enrichmentProgress?: { done: number; total: number } | null;
}) {
  if (total === 0) return null;

  const enriching = enrichmentProgress != null;
  const enrichPct = enriching
    ? Math.round((enrichmentProgress.done / enrichmentProgress.total) * 100)
    : 0;
  const availPct = Math.round((checked / total) * 100);
  const done = checked === total && loading === 0 && !enriching;

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
          ) : enriching ? (
            `Enriching from Open Library... ${enrichmentProgress.done} / ${enrichmentProgress.total}`
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
            {enriching ? `${enrichPct}%` : `${availPct}%`}
          </span>
        </div>
      </div>
      {!done && (
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${enriching ? "bg-purple-500" : "bg-amber-500"}`}
            style={{ width: `${enriching ? enrichPct : availPct}%` }}
          />
        </div>
      )}
    </div>
  );
}
