import { useState, useEffect, useCallback, useRef } from "react";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import { discoverFriends, fetchFriendShelf, type FriendShelf } from "~/lib/atproto/friends";

const CACHE_KEY = "shelfcheck:friends-cache";
const CACHE_VERSION = 1;
const CACHE_MAX_AGE = 1000 * 60 * 60 * 24 * 7; // 7 days
// Skip the background refresh + discovery sweep when the cache is younger than
// this. Page navigations within the window just rehydrate from localStorage.
const DISCOVERY_STALE_AGE = 1000 * 60 * 60 * 2; // 2 hours
const REFRESH_BATCH_SIZE = 5;

interface CachedFriends {
  version?: number;
  friends: FriendShelf[];
  fetchedAt: number;
}

function getCached(): CachedFriends | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedFriends;
    if (cached.version !== CACHE_VERSION) return null;
    if (Date.now() - cached.fetchedAt > CACHE_MAX_AGE) return null;
    return cached;
  } catch {
    return null;
  }
}

function setCache(friends: FriendShelf[]): void {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ version: CACHE_VERSION, friends, fetchedAt: Date.now() }),
    );
  } catch {
    // Ignore quota errors
  }
}

type FriendsStatus = "idle" | "loading" | "done" | "error";
type ProgressPhase = "refreshing" | "discovering";

interface FriendsProgress {
  checked: number;
  total: number;
  phase: ProgressPhase;
}

export function useFriends(session: OAuthSession | null) {
  // Hydrate from cache synchronously so the first paint shows previously
  // discovered friends instead of flashing an empty page.
  const [friends, setFriends] = useState<FriendShelf[]>(() => getCached()?.friends ?? []);
  const [status, setStatus] = useState<FriendsStatus>(() =>
    (getCached()?.friends?.length ?? 0) > 0 ? "done" : "idle",
  );
  const [refreshing, setRefreshing] = useState(false);
  const [progress, setProgress] = useState<FriendsProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshingDids, setRefreshingDids] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  const friendsRef = useRef<FriendShelf[]>(friends);

  useEffect(() => {
    friendsRef.current = friends;
  }, [friends]);

  const load = useCallback(
    async (force = false) => {
      if (!session) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setError(null);
      setProgress(null);

      // Hydrate from cache for instant UI
      const cached = getCached();
      let current: FriendShelf[] = cached?.friends ?? [];

      // If the cache is fresh, just hydrate and stop — discovery only runs on
      // a manual refresh or after the cache ages past DISCOVERY_STALE_AGE.
      if (!force && cached && Date.now() - cached.fetchedAt < DISCOVERY_STALE_AGE) {
        setFriends(current);
        setStatus("done");
        setRefreshing(false);
        return;
      }

      if (current.length > 0) {
        setFriends(current);
        setStatus("done");
        setRefreshing(true);
      } else {
        setFriends([]);
        setStatus("loading");
        setRefreshing(false);
      }

      try {
        // Phase 1: refresh known friends' shelves first (priority over discovery)
        if (current.length > 0) {
          // Mark every known friend as refreshing up front so each card shows a
          // per-user spinner immediately, not just the ones in the active batch.
          setRefreshingDids(new Set(current.map((f) => f.profile.did)));

          const refreshed: FriendShelf[] = [];
          for (let i = 0; i < current.length; i += REFRESH_BATCH_SIZE) {
            if (controller.signal.aborted) return;
            const batch = current.slice(i, i + REFRESH_BATCH_SIZE);
            const results = await Promise.allSettled(
              batch.map((f) => fetchFriendShelf(f.profile, { signal: controller.signal })),
            );
            for (let j = 0; j < results.length; j++) {
              const result = results[j];
              const original = batch[j];
              if (result.status === "fulfilled") {
                // null = the friend genuinely has no shelf entries anymore
                // (they removed every book, or never had any). Drop them.
                if (result.value) refreshed.push(result.value);
              } else {
                // Rejected = PDS unreachable / transport error. Keep the
                // previously-cached shelf so a transient outage on a self-
                // hosted PDS doesn't wipe the friend; refreshedAt stays put
                // so the UI can render a "stale since" indicator.
                refreshed.push(original);
              }
            }
            if (controller.signal.aborted) return;
            const checked = Math.min(i + REFRESH_BATCH_SIZE, current.length);
            setProgress({ checked, total: current.length, phase: "refreshing" });
            // Show in-progress merge: refreshed survivors + still-pending originals.
            const stillPending = current.slice(checked);
            setFriends([...refreshed, ...stillPending]);
            // Drop just-refreshed DIDs from the spinner set as their batch finishes.
            setRefreshingDids((prev) => {
              const next = new Set(prev);
              for (const f of batch) next.delete(f.profile.did);
              return next;
            });
          }
          current = refreshed;
          if (!controller.signal.aborted) {
            setFriends(refreshed);
            setCache(refreshed);
            setRefreshingDids(new Set());
          }
        }

        if (controller.signal.aborted) return;

        // Phase 2: discover new friends among follows we don't already know about
        setProgress(null);
        if (current.length === 0) {
          // No cached friends — show a single discovering bar from the start
          setRefreshing(false);
        } else {
          setRefreshing(true);
        }
        const knownDids = new Set(current.map((f) => f.profile.did));
        const newFriends = await discoverFriends(session, {
          signal: controller.signal,
          excludeDids: knownDids,
          onProgress: (checked, total) => {
            if (!controller.signal.aborted) {
              setProgress({ checked, total, phase: "discovering" });
            }
          },
        });

        if (controller.signal.aborted) return;
        const merged = [...current, ...newFriends];
        setFriends(merged);
        setCache(merged);
        setStatus("done");
        setRefreshing(false);
        setProgress(null);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load friends");
        // If we have something to show, keep showing it; otherwise surface the error state.
        if (friendsRef.current.length === 0) {
          setStatus("error");
        } else {
          setStatus("done");
        }
        setRefreshing(false);
        setProgress(null);
      }
    },
    [session],
  );

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  const refreshFriend = useCallback(async (did: string) => {
    const friend = friendsRef.current.find((f) => f.profile.did === did);
    if (!friend) return;
    setRefreshingDids((prev) => {
      if (prev.has(did)) return prev;
      const next = new Set(prev);
      next.add(did);
      return next;
    });
    try {
      const updated = await fetchFriendShelf(friend.profile);
      const next = updated
        ? friendsRef.current.map((f) => (f.profile.did === did ? updated : f))
        : friendsRef.current.filter((f) => f.profile.did !== did);
      setFriends(next);
      setCache(next);
    } catch {
      // Manual refresh errors are silent — the friend's existing data stays put.
    } finally {
      setRefreshingDids((prev) => {
        if (!prev.has(did)) return prev;
        const next = new Set(prev);
        next.delete(did);
        return next;
      });
    }
  }, []);

  return {
    friends,
    status,
    refreshing,
    progress,
    error,
    refresh,
    refreshFriend,
    refreshingDids,
  };
}
