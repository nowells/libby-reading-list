import { useEffect, useState } from "react";
import {
  initSession,
  syncBookhive,
  isBookhiveSyncStale,
  type AtprotoSessionInfo,
} from "~/lib/atproto";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import { getBookhiveLastSync } from "~/lib/storage";

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "just now";
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/**
 * Small status pill on the books page showing when we last pulled the
 * "want to read" list from the user's PDS. Auto-triggers a silent sync on
 * mount if the session is active and the last sync is missing or stale.
 * Clicking the pill forces a refresh.
 */
export function BookhiveSyncStatus({ onBooksChanged }: { onBooksChanged: () => void }) {
  const [session, setSession] = useState<OAuthSession | null>(null);
  const [info, setInfo] = useState<AtprotoSessionInfo | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(() => getBookhiveLastSync());
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runSync(s: OAuthSession, silent: boolean) {
    setSyncing(true);
    setError(null);
    try {
      const imported = await syncBookhive(s);
      setLastSync(getBookhiveLastSync());
      if (imported.length > 0) onBooksChanged();
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    initSession()
      .then((result) => {
        if (cancelled || !result) return;
        setSession(result.session);
        setInfo(result.info);
        if (isBookhiveSyncStale()) {
          void runSync(result.session, true);
        }
      })
      .catch(() => {
        // Non-fatal — the books page still works without a Bluesky session.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!session || !info) return null;

  const label = syncing
    ? "Syncing from atmosphere..."
    : lastSync
      ? `Synced from atmosphere ${formatRelativeTime(lastSync)}`
      : "Synced from atmosphere";

  return (
    <button
      type="button"
      onClick={() => runSync(session, false)}
      disabled={syncing}
      title={error ?? `Signed in as @${info.handle ?? info.did}`}
      className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/40 transition-colors disabled:opacity-70 whitespace-nowrap"
    >
      <svg
        className={`w-3 h-3 ${syncing ? "animate-spin" : ""}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
        />
      </svg>
      <span>{label}</span>
    </button>
  );
}
