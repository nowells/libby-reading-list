import { useEffect, useState } from "react";
import {
  initSession,
  refreshPdsSync,
  getLastPdsSync,
  getLastSignedInAccount,
  onSessionChange,
  signInWithBluesky,
  type AtprotoSessionInfo,
  type RememberedBskyAccount,
} from "~/lib/atproto";
import { onStorageMutation } from "~/lib/storage";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import { formatRelativeTime } from "../lib/format-relative-time";

/**
 * Small status pill on the books page showing when we last reconciled
 * org.shelfcheck.* records (and external sources — BookHive, Popfeed) with
 * the user's PDS. The full reconcile runs on every page load and on a
 * 15-minute auto-resync timer; this pill surfaces the last-sync timestamp
 * and provides a manual refresh affordance. If the OAuth session has been
 * lost (refresh token expired/revoked) but we still remember the account,
 * the pill flips to an amber "Reconnect Bluesky" button so reauth is
 * front-and-center where the user already looks for sync state.
 */
export function BookhiveSyncStatus({ onBooksChanged }: { onBooksChanged: () => void }) {
  const [session, setSession] = useState<OAuthSession | null>(null);
  const [info, setInfo] = useState<AtprotoSessionInfo | null>(null);
  // The remembered account drives the "Reconnect Bluesky" pill, but we only
  // populate it after a *confirmed* reauth failure — either initSession()
  // resolved without a session even though we have a remembered account on
  // disk, or the auto-sync detected an auth-lost error and notified us via
  // onSessionChange. Reading getLastSignedInAccount() eagerly on mount
  // would briefly render the reconnect pill while initSession is still in
  // flight, which is misleading: until we've actually tried and failed the
  // refresh, "no live session yet" is just "loading", not "needs reauth".
  const [authLost, setAuthLost] = useState<RememberedBskyAccount | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
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

  async function handleReconnect() {
    if (!authLost || reconnecting) return;
    setReconnecting(true);
    setError(null);
    try {
      await signInWithBluesky(authLost.handle ?? authLost.did);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reconnect failed");
      setReconnecting(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    initSession()
      .then((result) => {
        if (cancelled) return;
        if (result) {
          setSession(result.session);
          setInfo(result.info);
          setAuthLost(null);
          setLastSync(getLastPdsSync(result.info.did));
          // initSession already attached the sync engine and ran a reconcile,
          // so local state already reflects PDS state by the time we render.
          onBooksChanged();
        } else {
          // initSession resolved without a session — the refresh chain has
          // ended. If we remember an account from a prior successful sign-in
          // this is "needs reauth"; otherwise just "no Bluesky configured"
          // and we stay invisible.
          const remembered = getLastSignedInAccount();
          if (remembered) setAuthLost(remembered);
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

  // Listen for mid-session auth loss. When the auto-sync detects a refresh
  // failure it tears down the active session and notifies subscribers; we
  // drop the local session state so the pill swaps to "Reconnect Bluesky"
  // without forcing a page reload.
  useEffect(() => {
    return onSessionChange(() => {
      setSession(null);
      setInfo(null);
      const remembered = getLastSignedInAccount();
      if (remembered) setAuthLost(remembered);
    });
  }, []);

  // The 15-minute auto-resync writes books in the background through
  // setImportedBooks. Subscribe to those mutations so the books page
  // re-renders with the freshly-pulled list and the pill timestamp updates.
  useEffect(() => {
    if (!info) return;
    return onStorageMutation((m) => {
      if (m.kind === "books:bulkSet") {
        setLastSync(getLastPdsSync(info.did));
        onBooksChanged();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info?.did]);

  if (!session || !info) {
    if (!authLost) return null;
    const handleLabel = authLost.handle ?? authLost.did;
    return (
      <button
        type="button"
        onClick={handleReconnect}
        disabled={reconnecting}
        title={error ?? `Bluesky session expired — click to reconnect as @${handleLabel}`}
        className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors disabled:opacity-70 whitespace-nowrap"
      >
        <svg
          className="w-3 h-3"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
          />
        </svg>
        <span>{reconnecting ? "Reconnecting..." : `Reconnect Bluesky`}</span>
      </button>
    );
  }

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
