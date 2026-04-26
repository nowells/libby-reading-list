import { useState, useEffect, useCallback, useRef } from "react";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import { discoverFriends, type FriendShelf } from "~/lib/atproto/friends";

const CACHE_KEY = "shelfcheck:friends-cache";
const CACHE_MAX_AGE = 1000 * 60 * 30; // 30 minutes

interface CachedFriends {
  friends: FriendShelf[];
  fetchedAt: number;
}

function getCached(): CachedFriends | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached: CachedFriends = JSON.parse(raw);
    if (Date.now() - cached.fetchedAt > CACHE_MAX_AGE) return null;
    return cached;
  } catch {
    return null;
  }
}

function setCache(friends: FriendShelf[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ friends, fetchedAt: Date.now() }));
  } catch {
    // Ignore quota errors
  }
}

type FriendsStatus = "idle" | "loading" | "done" | "error";

export function useFriends(session: OAuthSession | null) {
  const [friends, setFriends] = useState<FriendShelf[]>([]);
  const [status, setStatus] = useState<FriendsStatus>("idle");
  const [progress, setProgress] = useState<{ checked: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (opts?: { skipCache?: boolean }) => {
      if (!session) return;

      if (!opts?.skipCache) {
        const cached = getCached();
        if (cached) {
          setFriends(cached.friends);
          setStatus("done");
          return;
        }
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setStatus("loading");
      setProgress(null);
      setError(null);

      try {
        const result = await discoverFriends(session, {
          signal: controller.signal,
          onProgress: (checked, total) => setProgress({ checked, total }),
        });
        if (!controller.signal.aborted) {
          setFriends(result);
          setCache(result);
          setStatus("done");
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Failed to load friends");
          setStatus("error");
        }
      }
    },
    [session],
  );

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  const refresh = useCallback(() => load({ skipCache: true }), [load]);

  return { friends, status, progress, error, refresh };
}
