import { describe, it, expect, vi } from "vitest";
import { render } from "vitest-browser-react";
import { MemoryRouter } from "react-router";
import { FriendCard } from "./friend-card";
import { STATUS, type ShelfEntryRecord, type AuthorFollowRecord } from "~/lib/atproto/lexicon";
import type { FriendShelf } from "~/lib/atproto/friends";

// FriendCard uses <Link> which requires a router context.
function renderCard(props: React.ComponentProps<typeof FriendCard>) {
  return render(
    <MemoryRouter>
      <FriendCard {...props} />
    </MemoryRouter>,
  );
}

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
    const screen = await renderCard({ friend: baseFriend });

    await expect.element(screen.getByText("Friend One")).toBeInTheDocument();
    await expect.element(screen.getByText("@friend1.bsky.social")).toBeInTheDocument();
    await expect.element(screen.getByText(/1 book/)).toBeInTheDocument();
  });

  it("links to /friends/:handle", async () => {
    const screen = await renderCard({ friend: baseFriend });

    const link = screen.container.querySelector(`a[href="/friends/${baseFriend.profile.handle}"]`);
    expect(link).not.toBeNull();
  });

  it("renders avatar initial when no avatar image", async () => {
    const noAvatarFriend: FriendShelf = {
      ...baseFriend,
      profile: { ...baseFriend.profile, avatar: undefined },
    };

    const screen = await renderCard({ friend: noAvatarFriend });

    const initial = screen.container.querySelector(".text-purple-600");
    expect(initial).not.toBeNull();
    expect(initial!.textContent).toBe("F");
  });

  it("renders status counts when entries cover multiple shelves", async () => {
    const friend: FriendShelf = {
      ...baseFriend,
      entries: [
        makeEntry({ status: STATUS.wantToRead, title: "A", ids: { olWorkId: "OL1W" } }),
        makeEntry({ status: STATUS.wantToRead, title: "B", ids: { olWorkId: "OL2W" } }),
        makeEntry({ status: STATUS.reading, title: "C", ids: { olWorkId: "OL3W" } }),
        makeEntry({ status: STATUS.finished, title: "D", ids: { olWorkId: "OL4W" } }),
      ],
    };

    const screen = await renderCard({ friend });

    await expect.element(screen.getByText(/2 want/)).toBeInTheDocument();
    await expect.element(screen.getByText(/1 reading/)).toBeInTheDocument();
    await expect.element(screen.getByText(/1 finished/)).toBeInTheDocument();
  });

  it("calls onRefresh when the refresh button is clicked", async () => {
    const onRefresh = vi.fn();
    const screen = await renderCard({ friend: baseFriend, onRefresh });

    await screen.getByLabelText(/Refresh Friend One's reading list/).click();

    expect(onRefresh).toHaveBeenCalledWith(baseFriend.profile.did);
  });

  it("disables refresh button while a refresh is in flight", async () => {
    const onRefresh = vi.fn();
    const screen = await renderCard({ friend: baseFriend, onRefresh, isRefreshing: true });

    const button = screen.container.querySelector<HTMLButtonElement>(
      'button[aria-label*="Refresh Friend One"]',
    );
    expect(button).not.toBeNull();
    expect(button!.disabled).toBe(true);
  });

  it("shows a stale badge when the friend has not been refreshed in over a day", async () => {
    const staleFriend: FriendShelf = {
      ...baseFriend,
      refreshedAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
    };

    const screen = await renderCard({ friend: staleFriend });

    await expect.element(screen.getByText(/stale, last seen/)).toBeInTheDocument();
  });
});
