import { useEffect, useState } from "react";

/**
 * Shown when a localStorage write fails with QuotaExceededError. The cache
 * migration to IDB normally keeps localStorage well under its 5 MB cap, but
 * if the user's quota is somehow still tight (large goodreads CSV import +
 * dozens of libraries + legacy data + tight private-mode budget) we want
 * them to know rather than silently losing a few books worth of PDS pull.
 */
export function StorageQuotaWarning() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handler = () => setVisible(true);
    window.addEventListener("shelfcheck:storage-quota-exceeded", handler as EventListener);
    return () =>
      window.removeEventListener("shelfcheck:storage-quota-exceeded", handler as EventListener);
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed top-4 left-4 right-4 z-50 flex justify-center pointer-events-none">
      <div className="bg-amber-50 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100 px-4 py-3 rounded-lg shadow-lg flex items-start gap-3 text-sm pointer-events-auto max-w-md">
        <svg
          className="w-5 h-5 flex-shrink-0 mt-0.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z"
          />
        </svg>
        <div className="flex-1">
          <div className="font-medium">Local storage is full</div>
          <p className="mt-1 text-xs leading-relaxed">
            Some recent changes may not have saved locally. Your reading list on the server is
            unaffected. Try clearing site data for ShelfCheck and reloading to resync from your PDS.
          </p>
        </div>
        <button
          onClick={() => setVisible(false)}
          className="text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 transition-colors"
          aria-label="Dismiss"
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
