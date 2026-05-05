import { useEffect, useState } from "react";

const FALLBACK_RELOAD_MS = 3000;

export function SwUpdateNotification() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.ready.then((registration) => {
      if (registration.waiting) {
        setWaitingWorker(registration.waiting);
      }

      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            setWaitingWorker(newWorker);
          }
        });
      });
    });

    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!refreshing) {
        refreshing = true;
        console.info("[sw] controllerchange — reloading to pick up new version");
        window.location.reload();
      }
    });
  }, []);

  if (!waitingWorker) return null;

  const handleUpdate = () => {
    if (updating) return;
    setUpdating(true);
    console.info("[sw] Update now clicked — sending SKIP_WAITING", waitingWorker.state);
    // ServiceWorker.postMessage does not use targetOrigin (that's Window.postMessage)
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
    // Belt-and-suspenders: if the SW never claims us (clients.claim races,
    // a self-hosted PDS for shelfcheck records is unrelated to this — but
    // if anything else swallows controllerchange) just hard-reload after
    // a short delay so the user is never stuck on the stale build.
    setTimeout(() => {
      console.info("[sw] fallback reload firing — controllerchange did not arrive");
      window.location.reload();
    }, FALLBACK_RELOAD_MS);
  };

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 flex justify-center pointer-events-none">
      <div className="bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 text-sm pointer-events-auto max-w-md">
        <span className="flex-1">A new version is available.</span>
        <button
          onClick={handleUpdate}
          disabled={updating}
          className="px-3 py-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white font-medium rounded transition-colors text-xs whitespace-nowrap"
        >
          {updating ? "Updating…" : "Update now"}
        </button>
        <button
          onClick={() => setWaitingWorker(null)}
          className="text-gray-400 dark:text-gray-500 hover:text-white dark:hover:text-gray-900 transition-colors"
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
