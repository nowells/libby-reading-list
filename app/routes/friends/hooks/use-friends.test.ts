import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "vitest-browser-react";
import { createElement } from "react";
import { useFriends } from "./use-friends";
import * as friendsModule from "~/lib/atproto/friends";

vi.mock("~/lib/atproto/friends", () => ({
  discoverFriends: vi.fn(),
}));

const CACHE_KEY = "shelfcheck:friends-cache";

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
  const { friends, status, error } = useFriends(session);
  return createElement(
    "div",
    null,
    createElement("span", null, `status:${status}`),
    createElement("span", null, `count:${friends.length}`),
    error && createElement("span", null, `error:${error}`),
  );
}

describe("useFriends", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("stays idle when no session provided", async () => {
    const screen = await render(createElement(HookHarness, { session: null }));
    await expect.element(screen.getByText("status:idle")).toBeInTheDocument();
    await expect.element(screen.getByText("count:0")).toBeInTheDocument();
  });

  it("loads friends from API on mount", async () => {
    vi.mocked(friendsModule.discoverFriends).mockResolvedValue([fakeFriend]);

    const screen = await render(createElement(HookHarness, { session: fakeSession }));

    await expect.element(screen.getByText("status:done")).toBeInTheDocument();
    await expect.element(screen.getByText("count:1")).toBeInTheDocument();
  });

  it("uses cached data when available", async () => {
    const cached = { friends: [fakeFriend], fetchedAt: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cached));

    const screen = await render(createElement(HookHarness, { session: fakeSession }));

    await expect.element(screen.getByText("status:done")).toBeInTheDocument();
    await expect.element(screen.getByText("count:1")).toBeInTheDocument();
    expect(friendsModule.discoverFriends).not.toHaveBeenCalled();
  });

  it("ignores expired cache", async () => {
    const expired = { friends: [fakeFriend], fetchedAt: Date.now() - 31 * 60 * 1000 };
    localStorage.setItem(CACHE_KEY, JSON.stringify(expired));

    vi.mocked(friendsModule.discoverFriends).mockResolvedValue([]);

    const screen = await render(createElement(HookHarness, { session: fakeSession }));

    await expect.element(screen.getByText("status:done")).toBeInTheDocument();
    expect(friendsModule.discoverFriends).toHaveBeenCalled();
  });

  it("handles errors gracefully", async () => {
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
    expect(cached.friends).toHaveLength(1);
    expect(cached.fetchedAt).toBeGreaterThan(0);
  });
});
