import { describe, it, expect, vi } from "vitest";
import { render } from "vitest-browser-react";
import { FriendCard } from "./friend-card";
import { STATUS, type ShelfEntryRecord, type AuthorFollowRecord } from "~/lib/atproto/lexicon";
import type { FriendShelf } from "~/lib/atproto/friends";

function makeEntry(overrides: Partial<ShelfEntryRecord> = {}): ShelfEntryRecord {
  return {
    status: STATUS.wantToRead,
    title: "Test Book",
    authors: [{ name: "Test Author" }],
    ids: { olWorkId: "OL1W" },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeAuthor(overrides: Partial<AuthorFollowRecord> = {}): AuthorFollowRecord {
  return {
    name: "Followed Author",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const baseFriend: FriendShelf = {
  profile: {
    did: "did:plc:friend1",
    handle: "friend1.bsky.social",
    displayName: "Friend One",
  },
  entries: [makeEntry()],
  authors: [makeAuthor()],
};

describe("FriendCard", () => {
  it("renders friend profile info", async () => {
    const screen = await render(
      <FriendCard
        friend={baseFriend}
        onAddBook={vi.fn()}
        onAddAuthor={vi.fn()}
        addedBookIds={new Set()}
        addedAuthorKeys={new Set()}
      />,
    );

    await expect.element(screen.getByText("Friend One")).toBeInTheDocument();
    await expect.element(screen.getByText("@friend1.bsky.social")).toBeInTheDocument();
    await expect.element(screen.getByText(/1 book/)).toBeInTheDocument();
  });

  it("expands to show books when clicked", async () => {
    const screen = await render(
      <FriendCard
        friend={baseFriend}
        onAddBook={vi.fn()}
        onAddAuthor={vi.fn()}
        addedBookIds={new Set()}
        addedAuthorKeys={new Set()}
      />,
    );

    // Click to expand
    await screen.getByText("Friend One").click();

    await expect.element(screen.getByText("Test Book")).toBeInTheDocument();
    await expect.element(screen.getByText("Test Author")).toBeInTheDocument();
  });

  it("calls onAddBook when add button is clicked", async () => {
    const onAddBook = vi.fn();
    const screen = await render(
      <FriendCard
        friend={baseFriend}
        onAddBook={onAddBook}
        onAddAuthor={vi.fn()}
        addedBookIds={new Set()}
        addedAuthorKeys={new Set()}
      />,
    );

    // Expand
    await screen.getByText("Friend One").click();

    // Click add
    await screen.getByText("+ Add").click();

    expect(onAddBook).toHaveBeenCalledWith(baseFriend.entries[0]);
  });

  it("shows 'Added' for already-added books", async () => {
    const screen = await render(
      <FriendCard
        friend={baseFriend}
        onAddBook={vi.fn()}
        onAddAuthor={vi.fn()}
        addedBookIds={new Set(["OL1W"])}
        addedAuthorKeys={new Set()}
      />,
    );

    await screen.getByText("Friend One").click();

    await expect.element(screen.getByText("Added")).toBeInTheDocument();
  });

  it("shows author tab and calls onAddAuthor", async () => {
    const onAddAuthor = vi.fn();
    const screen = await render(
      <FriendCard
        friend={baseFriend}
        onAddBook={vi.fn()}
        onAddAuthor={onAddAuthor}
        addedBookIds={new Set()}
        addedAuthorKeys={new Set()}
      />,
    );

    await screen.getByText("Friend One").click();
    await screen.getByText(/Authors \(1\)/).click();
    await screen.getByText("+ Follow").click();

    expect(onAddAuthor).toHaveBeenCalledWith("Followed Author", undefined);
  });

  it("renders status badges for different statuses", async () => {
    const friend: FriendShelf = {
      ...baseFriend,
      entries: [
        makeEntry({ status: STATUS.wantToRead, title: "Book A", ids: { olWorkId: "OL1W" } }),
        makeEntry({ status: STATUS.reading, title: "Book B", ids: { olWorkId: "OL2W" } }),
        makeEntry({ status: STATUS.finished, title: "Book C", ids: { olWorkId: "OL3W" } }),
      ],
    };

    const screen = await render(
      <FriendCard
        friend={friend}
        onAddBook={vi.fn()}
        onAddAuthor={vi.fn()}
        addedBookIds={new Set()}
        addedAuthorKeys={new Set()}
      />,
    );

    await screen.getByText("Friend One").click();

    // Check that status badge spans exist (use exact match to avoid tab buttons)
    await expect.element(screen.getByText("Want to Read", { exact: true })).toBeInTheDocument();
    await expect.element(screen.getByText("Reading", { exact: true })).toBeInTheDocument();
    // "Finished" appears both as a tab and a badge; check the badge exists via container
    const badges = screen.container.querySelectorAll("span.text-\\[10px\\]");
    expect(badges.length).toBe(3);
  });

  it("renders avatar initial when no avatar image", async () => {
    const noAvatarFriend: FriendShelf = {
      ...baseFriend,
      profile: { ...baseFriend.profile, avatar: undefined },
    };

    const screen = await render(
      <FriendCard
        friend={noAvatarFriend}
        onAddBook={vi.fn()}
        onAddAuthor={vi.fn()}
        addedBookIds={new Set()}
        addedAuthorKeys={new Set()}
      />,
    );

    // The avatar initial "F" is rendered inside a purple circle
    const initial = screen.container.querySelector(".text-purple-600");
    expect(initial).not.toBeNull();
    expect(initial!.textContent).toBe("F");
  });

  it("shows star ratings when present", async () => {
    const friend: FriendShelf = {
      ...baseFriend,
      entries: [makeEntry({ rating: 80 })], // 4 stars
    };

    const screen = await render(
      <FriendCard
        friend={friend}
        onAddBook={vi.fn()}
        onAddAuthor={vi.fn()}
        addedBookIds={new Set()}
        addedAuthorKeys={new Set()}
      />,
    );

    await screen.getByText("Friend One").click();
    await expect.element(screen.getByText("★★★★")).toBeInTheDocument();
  });

  it("calls onRefresh without expanding when refresh button is clicked", async () => {
    const onRefresh = vi.fn();
    const screen = await render(
      <FriendCard
        friend={baseFriend}
        onAddBook={vi.fn()}
        onAddAuthor={vi.fn()}
        onRefresh={onRefresh}
        addedBookIds={new Set()}
        addedAuthorKeys={new Set()}
      />,
    );

    await screen.getByLabelText(/Refresh Friend One's reading list/).click();

    expect(onRefresh).toHaveBeenCalledWith(baseFriend.profile.did);
    // Should not have expanded — book details stay hidden.
    expect(screen.container.textContent).not.toContain("Test Book");
  });

  it("disables refresh button while a refresh is in flight", async () => {
    const onRefresh = vi.fn();
    const screen = await render(
      <FriendCard
        friend={baseFriend}
        onAddBook={vi.fn()}
        onAddAuthor={vi.fn()}
        onRefresh={onRefresh}
        isRefreshing
        addedBookIds={new Set()}
        addedAuthorKeys={new Set()}
      />,
    );

    const button = screen.container.querySelector<HTMLButtonElement>(
      'button[aria-label*="Refresh Friend One"]',
    );
    expect(button).not.toBeNull();
    expect(button!.disabled).toBe(true);
  });

  it("filters entries by status tab", async () => {
    const friend: FriendShelf = {
      ...baseFriend,
      entries: [
        makeEntry({ status: STATUS.wantToRead, title: "Want Book", ids: { olWorkId: "OL1W" } }),
        makeEntry({ status: STATUS.finished, title: "Done Book", ids: { olWorkId: "OL2W" } }),
      ],
      authors: [],
    };

    const screen = await render(
      <FriendCard
        friend={friend}
        onAddBook={vi.fn()}
        onAddAuthor={vi.fn()}
        addedBookIds={new Set()}
        addedAuthorKeys={new Set()}
      />,
    );

    await screen.getByText("Friend One").click();

    // Click "Finished" tab
    await screen.getByText(/Finished \(1\)/).click();

    await expect.element(screen.getByText("Done Book")).toBeInTheDocument();
    // "Want Book" should not be visible when filtering by Finished
    expect(screen.container.textContent).not.toContain("Want Book");
  });
});
