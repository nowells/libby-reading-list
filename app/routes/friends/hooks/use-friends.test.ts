import { describe, it, expect, vi, beforeEach } from "vitest";
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
function HookHarness({ session }: { session: typeof fakeSession | null }) {
  const { friends, status, refreshing, error } = useFriends(session);
  return createElement(
    "div",
    null,
    createElement("span", null, `status:${status}`),
    createElement("span", null, `refreshing:${refreshing}`),
    createElement("span", null, `count:${friends.length}`),
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

  it("hydrates cached friends instantly and refreshes in background", async () => {
    const cached = {
      version: CACHE_VERSION,
      friends: [fakeFriend],
      fetchedAt: Date.now(),
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
      fetchedAt: Date.now(),
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cached));

    // Friend has no shelf entries anymore — fetchFriendShelf returns null.
    vi.mocked(friendsModule.fetchFriendShelf).mockResolvedValue(null);
    vi.mocked(friendsModule.discoverFriends).mockResolvedValue([]);

    const screen = await render(createElement(HookHarness, { session: fakeSession }));

    await expect.element(screen.getByText("refreshing:false")).toBeInTheDocument();
    await expect.element(screen.getByText("count:0")).toBeInTheDocument();
  });
});
