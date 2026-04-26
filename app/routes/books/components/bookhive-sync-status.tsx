import { useEffect, useState } from "react";
import {
  initSession,
  refreshPdsSync,
  getLastPdsSync,
  type AtprotoSessionInfo,
} from "~/lib/atproto";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import { formatRelativeTime } from "../lib/format-relative-time";

/**
 * Small status pill on the books page showing when we last reconciled
 * org.shelfcheck.* records with the user's PDS. The reconcile happens
 * automatically during initSession() (which is called on every page load
 * when a session is restored), so this pill is informational + provides a
 * manual refresh affordance.
 */
export function BookhiveSyncStatus({ onBooksChanged }: { onBooksChanged: () => void }) {
  const [session, setSession] = useState<OAuthSession | null>(null);
  const [info, setInfo] = useState<AtprotoSessionInfo | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runResync(did: string, silent: boolean) {
    setSyncing(true);
    setError(null);
    try {
      await refreshPdsSync(did);
      setLastSync(getLastPdsSync(did));
      onBooksChanged();
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
        setLastSync(getLastPdsSync(result.info.did));
        // initSession already attached the sync engine and ran a reconcile,
        // so local state already reflects PDS state by the time we render.
        onBooksChanged();
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
    ? "Syncing with PDS..."
    : lastSync
      ? `Synced ${formatRelativeTime(lastSync)}`
      : "Synced via ATproto";

  return (
    <button
      type="button"
      onClick={() => runResync(info.did, false)}
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
