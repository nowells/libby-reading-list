import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { render } from "vitest-browser-react";
import { createElement } from "react";
import { useFriends } from "./use-friends";
import * as friendsModule from "~/lib/atproto/friends";

vi.mock("~/lib/atproto/friends", () => ({
  discoverFriends: vi.fn(),
  fetchFriendShelf: vi.fn(),
}));

const CACHE_KEY = "shelfcheck:friends-cache";
const CACHE_VERSION = 1;
const HOUR = 60 * 60 * 1000;

const fakeSession = { did: "did:plc:testuser" } as never;

const fakeFriend: friendsModule.FriendShelf = {
  profile: {
    did: "did:plc:friend1",
    handle: "friend1.bsky.social",
    displayName: "Friend One",
  },
  entries: [
    {
      status: "org.shelfcheck.defs#wantToRead",
      title: "Test Book",
      authors: [{ name: "Author" }],
      ids: { olWorkId: "OL1W" },
      createdAt: new Date().toISOString(),
    },
  ],
  authors: [],
};

/** Tiny wrapper that renders hook state as visible text for assertion. */
function HookHarness({
  session,
  onRefresh,
}: {
  session: typeof fakeSession | null;
  onRefresh?: (refresh: () => void) => void;
}) {
  const { friends, status, refreshing, error, refresh, refreshingDids } = useFriends(session);
  if (onRefresh) onRefresh(refresh);
  const refreshingList = [...refreshingDids].sort().join(",");
  return createElement(
    "div",
    null,
    createElement("span", null, `status:${status}`),
    createElement("span", null, `refreshing:${refreshing}`),
    createElement("span", null, `count:${friends.length}`),
    createElement("span", null, `refreshingDids:${refreshingList}`),
    error && createElement("span", null, `error:${error}`),
  );
}

describe("useFriends", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(friendsModule.discoverFriends).mockResolvedValue([]);
    vi.mocked(friendsModule.fetchFriendShelf).mockResolvedValue(null);
  });

  it("stays idle when no session provided", async () => {
    const screen = await render(createElement(HookHarness, { session: null }));
    await expect.element(screen.getByText("status:idle")).toBeInTheDocument();
    await expect.element(screen.getByText("count:0")).toBeInTheDocument();
  });

  it("loads friends from API on mount when no cache", async () => {
    vi.mocked(friendsModule.discoverFriends).mockResolvedValue([fakeFriend]);

    const screen = await render(createElement(HookHarness, { session: fakeSession }));

    await expect.element(screen.getByText("status:done")).toBeInTheDocument();
    await expect.element(screen.getByText("count:1")).toBeInTheDocument();
    expect(friendsModule.discoverFriends).toHaveBeenCalled();
  });

  it("hydrates cached friends instantly and refreshes in background when cache is stale", async () => {
    // Older than the 2h discovery window but inside the 7d cache validity window.
    const cached = {
      version: CACHE_VERSION,
      friends: [fakeFriend],
      fetchedAt: Date.now() - 3 * HOUR,
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cached));

    vi.mocked(friendsModule.fetchFriendShelf).mockResolvedValue(fakeFriend);
    vi.mocked(friendsModule.discoverFriends).mockResolvedValue([]);

    const screen = await render(createElement(HookHarness, { session: fakeSession }));

    // Cached data shows up as "done" right away with refreshing toggled.
    await expect.element(screen.getByText("status:done")).toBeInTheDocument();
    await expect.element(screen.getByText("count:1")).toBeInTheDocument();

    // Eventually the background refresh settles and refreshing flips back to false.
    await expect.element(screen.getByText("refreshing:false")).toBeInTheDocument();
    expect(friendsModule.fetchFriendShelf).toHaveBeenCalled();
    // Discovery runs after known-friend refresh, excluding known DIDs.
    expect(friendsModule.discoverFriends).toHaveBeenCalled();
    const callArgs = vi.mocked(friendsModule.discoverFriends).mock.calls[0][1];
    expect(callArgs?.excludeDids).toBeDefined();
    const excluded = new Set(callArgs?.excludeDids ?? []);
    expect(excluded.has(fakeFriend.profile.did)).toBe(true);
  });

  it("ignores cache from older versions", async () => {
    const stale = {
      version: 0,
      friends: [fakeFriend],
      fetchedAt: Date.now(),
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(stale));

    const screen = await render(createElement(HookHarness, { session: fakeSession }));

    await expect.element(screen.getByText("status:done")).toBeInTheDocument();
    expect(friendsModule.discoverFriends).toHaveBeenCalled();
    // Without valid cache, no per-friend refresh should run.
    expect(friendsModule.fetchFriendShelf).not.toHaveBeenCalled();
  });

  it("ignores expired cache", async () => {
    const expired = {
      version: CACHE_VERSION,
      friends: [fakeFriend],
      fetchedAt: Date.now() - 8 * 24 * 60 * 60 * 1000, // older than 7 days
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(expired));

    const screen = await render(createElement(HookHarness, { session: fakeSession }));

    await expect.element(screen.getByText("status:done")).toBeInTheDocument();
    expect(friendsModule.discoverFriends).toHaveBeenCalled();
  });

  it("handles errors gracefully when no cached data", async () => {
    vi.mocked(friendsModule.discoverFriends).mockRejectedValue(new Error("Network error"));

    const screen = await render(createElement(HookHarness, { session: fakeSession }));

    await expect.element(screen.getByText("status:error")).toBeInTheDocument();
    await expect.element(screen.getByText("error:Network error")).toBeInTheDocument();
  });

  it("caches results to localStorage after load", async () => {
    vi.mocked(friendsModule.discoverFriends).mockResolvedValue([fakeFriend]);

    const screen = await render(createElement(HookHarness, { session: fakeSession }));

    await expect.element(screen.getByText("status:done")).toBeInTheDocument();

    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
    expect(cached).not.toBeNull();
    expect(cached.version).toBe(CACHE_VERSION);
    expect(cached.friends).toHaveLength(1);
    expect(cached.fetchedAt).toBeGreaterThan(0);
  });

  it("drops a known friend whose shelf is now empty", async () => {
    const cached = {
      version: CACHE_VERSION,
      friends: [fakeFriend],
      fetchedAt: Date.now() - 3 * HOUR,
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cached));

    // Friend has no shelf entries anymore — fetchFriendShelf returns null.
    vi.mocked(friendsModule.fetchFriendShelf).mockResolvedValue(null);
    vi.mocked(friendsModule.discoverFriends).mockResolvedValue([]);

    const screen = await render(createElement(HookHarness, { session: fakeSession }));

    await expect.element(screen.getByText("refreshing:false")).toBeInTheDocument();
    await expect.element(screen.getByText("count:0")).toBeInTheDocument();
  });

  it("keeps a known friend cached when their PDS errors during refresh", async () => {
    // The user-reported scenario: a self-hosted PDS goes down between
    // signins. The friend we already discovered shouldn't disappear; we
    // keep showing the cached entry (which the FriendCard surfaces with a
    // "stale" indicator off the unchanged refreshedAt).
    const staleFriend: friendsModule.FriendShelf = {
      ...fakeFriend,
      refreshedAt: Date.now() - 2 * 24 * HOUR, // 2 days old
    };
    const cached = {
      version: CACHE_VERSION,
      friends: [staleFriend],
      fetchedAt: Date.now() - 3 * HOUR,
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cached));

    vi.mocked(friendsModule.fetchFriendShelf).mockRejectedValue(
      new Error("PdsUnavailableError: 503"),
    );
    vi.mocked(friendsModule.discoverFriends).mockResolvedValue([]);

    const screen = await render(createElement(HookHarness, { session: fakeSession }));

    await expect.element(screen.getByText("refreshing:false")).toBeInTheDocument();
    await expect.element(screen.getByText("count:1")).toBeInTheDocument();

    // The cache should still hold the friend with their original refreshedAt
    // intact — the failed refresh must not advance the timestamp.
    const written = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
    expect(written.friends).toHaveLength(1);
    expect(written.friends[0].refreshedAt).toBe(staleFriend.refreshedAt);
  });

  it("skips discovery when the cache is fresher than the 2h discovery window", async () => {
    const cached = {
      version: CACHE_VERSION,
      friends: [fakeFriend],
      fetchedAt: Date.now() - 30 * 60 * 1000, // 30 minutes ago
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cached));

    const screen = await render(createElement(HookHarness, { session: fakeSession }));

    await expect.element(screen.getByText("status:done")).toBeInTheDocument();
    await expect.element(screen.getByText("count:1")).toBeInTheDocument();
    await expect.element(screen.getByText("refreshing:false")).toBeInTheDocument();
    expect(friendsModule.discoverFriends).not.toHaveBeenCalled();
    expect(friendsModule.fetchFriendShelf).not.toHaveBeenCalled();
  });

  it("hydrates cached friends synchronously so the first paint is not empty", async () => {
    const cached = {
      version: CACHE_VERSION,
      friends: [fakeFriend],
      fetchedAt: Date.now() - 30 * 60 * 1000, // fresh, so no background work fires
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cached));

    // Pass session=null so load() bails immediately. Anything visible now had
    // to come from the synchronous useState initializer, not a later effect.
    const screen = await render(createElement(HookHarness, { session: null }));

    await expect.element(screen.getByText("status:done")).toBeInTheDocument();
    await expect.element(screen.getByText("count:1")).toBeInTheDocument();
    expect(friendsModule.discoverFriends).not.toHaveBeenCalled();
    expect(friendsModule.fetchFriendShelf).not.toHaveBeenCalled();
  });

  it("marks every cached friend as refreshing during the bulk refresh phase", async () => {
    const friendA: friendsModule.FriendShelf = {
      profile: { did: "did:plc:friendA", handle: "a.bsky.social" },
      entries: [],
      authors: [],
    };
    const friendB: friendsModule.FriendShelf = {
      profile: { did: "did:plc:friendB", handle: "b.bsky.social" },
      entries: [],
      authors: [],
    };

    const cached = {
      version: CACHE_VERSION,
      friends: [friendA, friendB],
      fetchedAt: Date.now() - 3 * HOUR, // stale → triggers background refresh
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cached));

    // Hold both refreshes pending so we can observe the spinner state.
    let resolveA: ((v: friendsModule.FriendShelf | null) => void) | null = null;
    let resolveB: ((v: friendsModule.FriendShelf | null) => void) | null = null;
    vi.mocked(friendsModule.fetchFriendShelf).mockImplementation((profile) => {
      return new Promise<friendsModule.FriendShelf | null>((resolve) => {
        if (profile.did === friendA.profile.did) resolveA = resolve;
        else resolveB = resolve;
      });
    });
    vi.mocked(friendsModule.discoverFriends).mockResolvedValue([]);

    const screen = await render(createElement(HookHarness, { session: fakeSession }));

    await expect
      .element(screen.getByText(`refreshingDids:${friendA.profile.did},${friendB.profile.did}`))
      .toBeInTheDocument();

    await act(async () => {
      resolveA!(friendA);
      resolveB!(friendB);
    });

    await expect.element(screen.getByText("refreshingDids:")).toBeInTheDocument();
    await expect.element(screen.getByText("refreshing:false")).toBeInTheDocument();
  });

  it("manual refresh forces discovery even when cache is fresh", async () => {
    const cached = {
      version: CACHE_VERSION,
      friends: [fakeFriend],
      fetchedAt: Date.now() - 30 * 60 * 1000, // fresh
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cached));

    vi.mocked(friendsModule.fetchFriendShelf).mockResolvedValue(fakeFriend);
    vi.mocked(friendsModule.discoverFriends).mockResolvedValue([]);

    let triggerRefresh: (() => void) | null = null;
    const screen = await render(
      createElement(HookHarness, {
        session: fakeSession,
        onRefresh: (r) => {
          triggerRefresh = r;
        },
      }),
    );

    // Mount-time load skips discovery because the cache is fresh.
    await expect.element(screen.getByText("status:done")).toBeInTheDocument();
    expect(friendsModule.discoverFriends).not.toHaveBeenCalled();

    // Manual refresh ignores the freshness check.
    await act(async () => {
      triggerRefresh!();
    });
    await vi.waitFor(() => {
      expect(friendsModule.discoverFriends).toHaveBeenCalled();
      expect(friendsModule.fetchFriendShelf).toHaveBeenCalled();
    });
  });
});
