import { describe, it, expect, vi } from "vitest";
import { render } from "vitest-browser-react";
import { MemoryRouter, Route, Routes } from "react-router";
import { STATUS } from "~/lib/atproto/lexicon";
import type { FriendShelf } from "~/lib/atproto/friends";

const mockGetLibraries = vi
  .fn()
  .mockReturnValue([{ key: "lib1", preferredKey: "lib1", name: "Test Library" }]);
const mockGetBooks = vi.fn().mockReturnValue([]);
const mockGetAuthors = vi.fn().mockReturnValue([]);
const mockGetReadBooks = vi.fn().mockReturnValue([]);
const mockAddBook = vi.fn();
const mockAddAuthor = vi.fn();

vi.mock("~/lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/storage")>();
  return {
    ...actual,
    getLibraries: (...args: unknown[]) => mockGetLibraries(...args),
    getBooks: (...args: unknown[]) => mockGetBooks(...args),
    getAuthors: (...args: unknown[]) => mockGetAuthors(...args),
    getReadBooks: (...args: unknown[]) => mockGetReadBooks(...args),
    addBook: (...args: unknown[]) => mockAddBook(...args),
    addAuthor: (...args: unknown[]) => mockAddAuthor(...args),
  };
});

const mockInitSession = vi.fn();
vi.mock("~/lib/atproto", () => ({
  initSession: (...args: unknown[]) => mockInitSession(...args),
}));

const mockUseFriends = vi.fn();
vi.mock("~/routes/friends/hooks/use-friends", () => ({
  useFriends: (...args: unknown[]) => mockUseFriends(...args),
}));

const { default: FriendDetail } = await import("./route");

const fakeFriend: FriendShelf = {
  profile: {
    did: "did:plc:friend1",
    handle: "alice.bsky.social",
    displayName: "Alice Reader",
  },
  entries: [
    {
      status: STATUS.wantToRead,
      title: "The Great Gatsby",
      authors: [{ name: "F. Scott Fitzgerald" }],
      ids: { olWorkId: "OL468431W" },
      createdAt: new Date().toISOString(),
    },
    {
      status: STATUS.reading,
      title: "1984",
      authors: [{ name: "George Orwell" }],
      ids: { olWorkId: "OL1168083W" },
      createdAt: new Date().toISOString(),
    },
    {
      status: STATUS.finished,
      title: "To Kill a Mockingbird",
      authors: [{ name: "Harper Lee" }],
      ids: { olWorkId: "OL4397665W" },
      rating: 80,
      createdAt: new Date().toISOString(),
    },
  ],
  authors: [],
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/friends/:handle" element={<FriendDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

const session = { did: "did:plc:viewer" };

describe("FriendDetail", () => {
  it("renders the friend metadata header", async () => {
    mockInitSession.mockResolvedValue({ session, info: session, fresh: false });
    mockUseFriends.mockReturnValue({
      friends: [fakeFriend],
      status: "done",
      refreshing: false,
      refreshFriend: vi.fn(),
      refreshingDids: new Set(),
    });

    const screen = await renderAt("/friends/alice.bsky.social");

    await expect.element(screen.getByText("Alice Reader")).toBeVisible();
    await expect.element(screen.getByText("@alice.bsky.social")).toBeVisible();
    await expect.element(screen.getByText(/3 books/)).toBeVisible();
  });

  it("filters by friend's status — defaults to want-to-read", async () => {
    mockInitSession.mockResolvedValue({ session, info: session, fresh: false });
    mockUseFriends.mockReturnValue({
      friends: [fakeFriend],
      status: "done",
      refreshing: false,
      refreshFriend: vi.fn(),
      refreshingDids: new Set(),
    });

    const screen = await renderAt("/friends/alice.bsky.social");

    // Want-to-read tab is active by default → Gatsby visible, 1984 / Mockingbird hidden.
    await expect.element(screen.getByText("The Great Gatsby")).toBeVisible();
    expect(screen.container.textContent).not.toContain("1984");
    expect(screen.container.textContent).not.toContain("To Kill a Mockingbird");
  });

  it("switches to friend's reading shelf via the Reading pill", async () => {
    mockInitSession.mockResolvedValue({ session, info: session, fresh: false });
    mockUseFriends.mockReturnValue({
      friends: [fakeFriend],
      status: "done",
      refreshing: false,
      refreshFriend: vi.fn(),
      refreshingDids: new Set(),
    });

    const screen = await renderAt("/friends/alice.bsky.social");

    await screen.getByRole("button", { name: /^Reading \(\d+\)$/ }).click();

    await expect.element(screen.getByText("1984")).toBeVisible();
    expect(screen.container.textContent).not.toContain("The Great Gatsby");
  });

  it("shows '+ Add to Want to Read' when the viewer doesn't own the book", async () => {
    mockInitSession.mockResolvedValue({ session, info: session, fresh: false });
    mockGetBooks.mockReturnValueOnce([]);
    mockUseFriends.mockReturnValue({
      friends: [fakeFriend],
      status: "done",
      refreshing: false,
      refreshFriend: vi.fn(),
      refreshingDids: new Set(),
    });

    const screen = await renderAt("/friends/alice.bsky.social");

    await expect.element(screen.getByText(/Add to Want to Read/i).first()).toBeVisible();
  });

  it("shows 'On your shelf' when the viewer already has the book", async () => {
    mockInitSession.mockResolvedValue({ session, info: session, fresh: false });
    mockGetBooks.mockReturnValueOnce([
      {
        id: "local-1",
        title: "The Great Gatsby",
        author: "F. Scott Fitzgerald",
        source: "unknown",
        workId: "OL468431W",
        status: "reading",
      },
    ]);
    mockUseFriends.mockReturnValue({
      friends: [fakeFriend],
      status: "done",
      refreshing: false,
      refreshFriend: vi.fn(),
      refreshingDids: new Set(),
    });

    const screen = await renderAt("/friends/alice.bsky.social");

    await expect.element(screen.getByText(/On your shelf/i).first()).toBeVisible();
  });

  it("calls addBook when '+ Add to Want to Read' is clicked", async () => {
    mockInitSession.mockResolvedValue({ session, info: session, fresh: false });
    mockGetBooks.mockReturnValueOnce([]);
    mockUseFriends.mockReturnValue({
      friends: [fakeFriend],
      status: "done",
      refreshing: false,
      refreshFriend: vi.fn(),
      refreshingDids: new Set(),
    });

    const screen = await renderAt("/friends/alice.bsky.social");

    await screen.getByLabelText(/Add The Great Gatsby to your want-to-read shelf/i).click();

    expect(mockAddBook).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "The Great Gatsby",
        author: "F. Scott Fitzgerald",
        workId: "OL468431W",
        status: "wantToRead",
      }),
    );
  });

  it("shows a not-found state when the URL handle doesn't match any friend", async () => {
    mockInitSession.mockResolvedValue({ session, info: session, fresh: false });
    mockUseFriends.mockReturnValue({
      friends: [fakeFriend],
      status: "done",
      refreshing: false,
      refreshFriend: vi.fn(),
      refreshingDids: new Set(),
    });

    const screen = await renderAt("/friends/missing.bsky.social");

    await expect.element(screen.getByText(/Friend not found/i)).toBeVisible();
    await expect.element(screen.getByText(/@missing\.bsky\.social/)).toBeVisible();
  });

  it("invokes refreshFriend when the header refresh button is clicked", async () => {
    const refreshFriend = vi.fn();
    mockInitSession.mockResolvedValue({ session, info: session, fresh: false });
    mockUseFriends.mockReturnValue({
      friends: [fakeFriend],
      status: "done",
      refreshing: false,
      refreshFriend,
      refreshingDids: new Set(),
    });

    const screen = await renderAt("/friends/alice.bsky.social");

    await screen.getByLabelText(/Refresh Alice Reader's reading list/).click();

    expect(refreshFriend).toHaveBeenCalledWith(fakeFriend.profile.did);
  });
});
