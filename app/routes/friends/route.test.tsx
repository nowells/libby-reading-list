import { describe, it, expect, vi } from "vitest";
import { render } from "vitest-browser-react";
import { MemoryRouter } from "react-router";
import { componentLocator } from "~/test/screenshot";
import { STATUS } from "~/lib/atproto/lexicon";
import type { FriendShelf } from "~/lib/atproto/friends";

const mockGetLibraries = vi
  .fn()
  .mockReturnValue([{ key: "lib1", preferredKey: "lib1", name: "Test Library" }]);
const mockGetBooks = vi.fn().mockReturnValue([]);
const mockGetAuthors = vi.fn().mockReturnValue([]);
const mockAddBook = vi.fn();
const mockAddAuthor = vi.fn();

vi.mock("~/lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/storage")>();
  return {
    ...actual,
    getLibraries: (...args: unknown[]) => mockGetLibraries(...args),
    getBooks: (...args: unknown[]) => mockGetBooks(...args),
    getAuthors: (...args: unknown[]) => mockGetAuthors(...args),
    addBook: (...args: unknown[]) => mockAddBook(...args),
    addAuthor: (...args: unknown[]) => mockAddAuthor(...args),
  };
});

const mockInitSession = vi.fn();
vi.mock("~/lib/atproto", () => ({
  initSession: (...args: unknown[]) => mockInitSession(...args),
}));

const mockUseFriends = vi.fn();
vi.mock("./hooks/use-friends", () => ({
  useFriends: (...args: unknown[]) => mockUseFriends(...args),
}));

const { default: Friends } = await import("./route");

const fakeFriend: FriendShelf = {
  profile: {
    did: "did:plc:friend1",
    handle: "friend1.bsky.social",
    displayName: "Alice Reader",
    avatar: undefined,
  },
  entries: [
    {
      status: STATUS.wantToRead,
      title: "The Great Gatsby",
      authors: [{ name: "F. Scott Fitzgerald" }],
      ids: { olWorkId: "OL468431W" },
      coverUrl: undefined,
      createdAt: new Date().toISOString(),
    },
    {
      status: STATUS.reading,
      title: "1984",
      authors: [{ name: "George Orwell" }],
      ids: { olWorkId: "OL1168083W" },
      coverUrl: undefined,
      createdAt: new Date().toISOString(),
    },
    {
      status: STATUS.finished,
      title: "To Kill a Mockingbird",
      authors: [{ name: "Harper Lee" }],
      ids: { olWorkId: "OL4397665W" },
      rating: 80,
      coverUrl: undefined,
      createdAt: new Date().toISOString(),
    },
  ],
  authors: [
    { name: "F. Scott Fitzgerald", olAuthorKey: "OL27349A", createdAt: new Date().toISOString() },
  ],
};

describe("Friends", () => {
  it("shows sign-in prompt when not logged in", async () => {
    mockInitSession.mockResolvedValue(null);
    mockUseFriends.mockReturnValue({
      friends: [],
      status: "idle",
      refreshing: false,
      progress: null,
      error: null,
      refresh: vi.fn(),
      refreshFriend: vi.fn(),
      refreshingDids: new Set(),
    });

    const screen = await render(
      <MemoryRouter>
        <Friends />
      </MemoryRouter>,
    );

    await expect.element(screen.getByText("Sign in with Bluesky to see friends")).toBeVisible();
  });

  it("sign-in prompt matches screenshot", async () => {
    mockInitSession.mockResolvedValue(null);
    mockUseFriends.mockReturnValue({
      friends: [],
      status: "idle",
      progress: null,
      error: null,
      refresh: vi.fn(),
      refreshing: false,
      refreshFriend: vi.fn(),
      refreshingDids: new Set(),
    });

    const screen = await render(
      <MemoryRouter>
        <Friends />
      </MemoryRouter>,
    );

    await expect.element(screen.getByText("Sign in with Bluesky to see friends")).toBeVisible();
    await expect.element(componentLocator(screen)).toMatchScreenshot("friends-sign-in");
  });

  it("shows loading state", async () => {
    mockInitSession.mockResolvedValue({
      session: { did: "did:plc:test" },
      info: { did: "did:plc:test" },
      fresh: false,
    });
    mockUseFriends.mockReturnValue({
      friends: [],
      status: "loading",
      progress: { checked: 5, total: 20 },
      error: null,
      refresh: vi.fn(),
      refreshing: false,
      refreshFriend: vi.fn(),
      refreshingDids: new Set(),
    });

    const screen = await render(
      <MemoryRouter>
        <Friends />
      </MemoryRouter>,
    );

    await expect.element(screen.getByText("Discovering friends...")).toBeVisible();
    await expect.element(screen.getByText("Checked 5 of 20 follows")).toBeVisible();
  });

  it("loading state matches screenshot", async () => {
    mockInitSession.mockResolvedValue({
      session: { did: "did:plc:test" },
      info: { did: "did:plc:test" },
      fresh: false,
    });
    mockUseFriends.mockReturnValue({
      friends: [],
      status: "loading",
      progress: { checked: 5, total: 20 },
      error: null,
      refresh: vi.fn(),
      refreshing: false,
      refreshFriend: vi.fn(),
      refreshingDids: new Set(),
    });

    const screen = await render(
      <MemoryRouter>
        <Friends />
      </MemoryRouter>,
    );

    await expect.element(screen.getByText("Discovering friends...")).toBeVisible();
    await expect.element(componentLocator(screen)).toMatchScreenshot("friends-loading");
  });

  it("shows empty state when no friends found", async () => {
    mockInitSession.mockResolvedValue({
      session: { did: "did:plc:test" },
      info: { did: "did:plc:test" },
      fresh: false,
    });
    mockUseFriends.mockReturnValue({
      friends: [],
      status: "done",
      progress: null,
      error: null,
      refresh: vi.fn(),
      refreshing: false,
      refreshFriend: vi.fn(),
      refreshingDids: new Set(),
    });

    const screen = await render(
      <MemoryRouter>
        <Friends />
      </MemoryRouter>,
    );

    await expect
      .element(screen.getByText(/None of your Bluesky follows use ShelfCheck yet/))
      .toBeVisible();
  });

  it("empty state matches screenshot", async () => {
    mockInitSession.mockResolvedValue({
      session: { did: "did:plc:test" },
      info: { did: "did:plc:test" },
      fresh: false,
    });
    mockUseFriends.mockReturnValue({
      friends: [],
      status: "done",
      progress: null,
      error: null,
      refresh: vi.fn(),
      refreshing: false,
      refreshFriend: vi.fn(),
      refreshingDids: new Set(),
    });

    const screen = await render(
      <MemoryRouter>
        <Friends />
      </MemoryRouter>,
    );

    await expect.element(screen.getByText(/None of your Bluesky follows/)).toBeVisible();
    await expect.element(componentLocator(screen)).toMatchScreenshot("friends-empty");
  });

  it("shows friend cards when friends exist", async () => {
    mockInitSession.mockResolvedValue({
      session: { did: "did:plc:test" },
      info: { did: "did:plc:test" },
      fresh: false,
    });
    mockUseFriends.mockReturnValue({
      friends: [fakeFriend],
      status: "done",
      progress: null,
      error: null,
      refresh: vi.fn(),
      refreshing: false,
      refreshFriend: vi.fn(),
      refreshingDids: new Set(),
    });

    const screen = await render(
      <MemoryRouter>
        <Friends />
      </MemoryRouter>,
    );

    await expect.element(screen.getByText("Alice Reader")).toBeVisible();
    await expect.element(screen.getByText("@friend1.bsky.social")).toBeVisible();
    await expect.element(screen.getByText(/3 books/)).toBeVisible();
  });

  it("friends list matches screenshot", async () => {
    mockInitSession.mockResolvedValue({
      session: { did: "did:plc:test" },
      info: { did: "did:plc:test" },
      fresh: false,
    });
    mockUseFriends.mockReturnValue({
      friends: [fakeFriend],
      status: "done",
      progress: null,
      error: null,
      refresh: vi.fn(),
      refreshing: false,
      refreshFriend: vi.fn(),
      refreshingDids: new Set(),
    });

    const screen = await render(
      <MemoryRouter>
        <Friends />
      </MemoryRouter>,
    );

    await expect.element(screen.getByText("Alice Reader")).toBeVisible();
    await expect.element(componentLocator(screen)).toMatchScreenshot("friends-list");
  });

  it("shows error state", async () => {
    mockInitSession.mockResolvedValue({
      session: { did: "did:plc:test" },
      info: { did: "did:plc:test" },
      fresh: false,
    });
    mockUseFriends.mockReturnValue({
      friends: [],
      status: "error",
      progress: null,
      error: "Network timeout",
      refresh: vi.fn(),
      refreshing: false,
      refreshFriend: vi.fn(),
      refreshingDids: new Set(),
    });

    const screen = await render(
      <MemoryRouter>
        <Friends />
      </MemoryRouter>,
    );

    await expect.element(screen.getByText("Network timeout")).toBeVisible();
    await expect.element(screen.getByText("Try again")).toBeVisible();
  });

  it("error state matches screenshot", async () => {
    mockInitSession.mockResolvedValue({
      session: { did: "did:plc:test" },
      info: { did: "did:plc:test" },
      fresh: false,
    });
    mockUseFriends.mockReturnValue({
      friends: [],
      status: "error",
      progress: null,
      error: "Network timeout",
      refresh: vi.fn(),
      refreshing: false,
      refreshFriend: vi.fn(),
      refreshingDids: new Set(),
    });

    const screen = await render(
      <MemoryRouter>
        <Friends />
      </MemoryRouter>,
    );

    await expect.element(screen.getByText("Network timeout")).toBeVisible();
    await expect.element(componentLocator(screen)).toMatchScreenshot("friends-error");
  });

  it("shows top-level progress bar instead of replacing friends when refreshing", async () => {
    mockInitSession.mockResolvedValue({
      session: { did: "did:plc:test" },
      info: { did: "did:plc:test" },
      fresh: false,
    });
    mockUseFriends.mockReturnValue({
      friends: [fakeFriend],
      status: "done",
      progress: { checked: 12, total: 50, phase: "discovering" },
      error: null,
      refresh: vi.fn(),
      refreshing: true,
      refreshFriend: vi.fn(),
      refreshingDids: new Set(),
    });

    const screen = await render(
      <MemoryRouter>
        <Friends />
      </MemoryRouter>,
    );

    // Cached friend is still rendered
    await expect.element(screen.getByText("Alice Reader")).toBeVisible();
    // Progress bar at the top (not replacing the list)
    await expect.element(screen.getByText(/Discovering new friends/)).toBeVisible();
  });

  it("invokes refreshFriend when friend's refresh button is clicked", async () => {
    const refreshFriend = vi.fn();
    mockInitSession.mockResolvedValue({
      session: { did: "did:plc:test" },
      info: { did: "did:plc:test" },
      fresh: false,
    });
    mockUseFriends.mockReturnValue({
      friends: [fakeFriend],
      status: "done",
      progress: null,
      error: null,
      refresh: vi.fn(),
      refreshing: false,
      refreshFriend,
      refreshingDids: new Set(),
    });

    const screen = await render(
      <MemoryRouter>
        <Friends />
      </MemoryRouter>,
    );

    await screen.getByLabelText(/Refresh Alice Reader's reading list/).click();
    expect(refreshFriend).toHaveBeenCalledWith(fakeFriend.profile.did);
  });
});
