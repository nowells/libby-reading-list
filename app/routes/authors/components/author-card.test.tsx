import { describe, it, expect, vi } from "vitest";
import { render } from "vitest-browser-react";
import { MemoryRouter } from "react-router";
import { AuthorCard } from "./author-card";
import type { AuthorAvailState, AuthorBookResult } from "../hooks/use-author-availability";
import { mockLibraries } from "~/test/msw/data";
import type { AuthorEntry } from "~/lib/storage";

// AuthorCard renders <Link> elements for the author header and each work
// title, so a router context is required during tests.
function withRouter(node: React.ReactNode) {
  return <MemoryRouter>{node}</MemoryRouter>;
}

const author: AuthorEntry = { id: "author-1", name: "Adrian Tchaikovsky", olKey: "OL7313085A" };

function makeWork(overrides: Partial<AuthorBookResult> = {}): AuthorBookResult {
  return {
    title: "Children of Time",
    firstPublishYear: 2015,
    coverId: 12345,
    olWorkKey: "/works/OL1W",
    libbyResults: [
      {
        mediaItem: {
          id: "media-1",
          title: "Children of Time",
          sortTitle: "children of time",
          type: { id: "ebook", name: "eBook" },
          formats: [{ id: "ebook-overdrive", name: "OverDrive Read" }],
          creators: [{ name: "Adrian Tchaikovsky", role: "Author" }],
          publisher: { id: "pub-1", name: "Publisher" },
          publishDate: "2015-06-04",
          isAvailable: true,
          ownedCopies: 5,
          availableCopies: 2,
          holdsCount: 0,
        },
        availability: {
          id: "media-1",
          copiesOwned: 5,
          copiesAvailable: 2,
          numberOfHolds: 0,
          isAvailable: true,
        },
        formatType: "ebook",
        libraryKey: "lapl",
      },
    ],
    ...overrides,
  };
}

const defaultHandlers = {
  onRefresh: vi.fn(),
  onRemove: vi.fn(),
  onWantToRead: vi.fn(),
  onMarkRead: vi.fn(),
  onDismissWork: vi.fn(),
  isWorkRead: () => false,
  isWorkDismissed: () => false,
};

describe("AuthorCard", () => {
  it("renders author name when done loading", async () => {
    const state: AuthorAvailState = {
      status: "done",
      olKey: "OL7313085A",
      resolvedName: "Adrian Tchaikovsky",
      works: [makeWork()],
      fetchedAt: Date.now(),
    };
    const screen = await render(
      withRouter(
        <AuthorCard author={author} state={state} libraries={mockLibraries} {...defaultHandlers} />,
      ),
    );
    await expect.element(screen.getByText("Adrian Tchaikovsky")).toBeVisible();
  });

  it("shows works count and in-library count", async () => {
    const state: AuthorAvailState = {
      status: "done",
      olKey: "OL7313085A",
      resolvedName: "Adrian Tchaikovsky",
      works: [
        makeWork(),
        makeWork({ title: "Children of Ruin", olWorkKey: "/works/OL2W", libbyResults: [] }),
      ],
      fetchedAt: Date.now(),
    };
    const screen = await render(
      withRouter(
        <AuthorCard author={author} state={state} libraries={mockLibraries} {...defaultHandlers} />,
      ),
    );
    await expect.element(screen.getByText("2 works · 1 in library")).toBeVisible();
  });

  it("shows loading state with progress", async () => {
    const state: AuthorAvailState = {
      status: "loading-availability",
      works: [],
      progress: { done: 3, total: 10 },
    };
    const screen = await render(
      withRouter(
        <AuthorCard author={author} state={state} libraries={mockLibraries} {...defaultHandlers} />,
      ),
    );
    await expect.element(screen.getByText("Checking availability... 3/10")).toBeVisible();
  });

  it("shows loading-works state", async () => {
    const state: AuthorAvailState = {
      status: "loading-works",
      works: [],
    };
    const screen = await render(
      withRouter(
        <AuthorCard author={author} state={state} libraries={mockLibraries} {...defaultHandlers} />,
      ),
    );
    await expect.element(screen.getByText("Loading works...")).toBeVisible();
  });

  it("shows error state", async () => {
    const state: AuthorAvailState = {
      status: "error",
      works: [],
      error: 'Could not find "Unknown Author" on Open Library',
    };
    const screen = await render(
      withRouter(
        <AuthorCard
          author={{ id: "a-2", name: "Unknown Author" }}
          state={state}
          libraries={mockLibraries}
          {...defaultHandlers}
        />,
      ),
    );
    await expect
      .element(screen.getByText('Could not find "Unknown Author" on Open Library'))
      .toBeVisible();
  });

  it("renders work titles in the expanded list", async () => {
    const state: AuthorAvailState = {
      status: "done",
      olKey: "OL7313085A",
      resolvedName: "Adrian Tchaikovsky",
      works: [makeWork()],
      fetchedAt: Date.now(),
    };
    const screen = await render(
      withRouter(
        <AuthorCard author={author} state={state} libraries={mockLibraries} {...defaultHandlers} />,
      ),
    );
    await expect.element(screen.getByText("Children of Time")).toBeVisible();
  });

  it("shows 'Not in library' for works without results", async () => {
    const state: AuthorAvailState = {
      status: "done",
      olKey: "OL7313085A",
      resolvedName: "Adrian Tchaikovsky",
      works: [makeWork({ libbyResults: [] })],
      fetchedAt: Date.now(),
    };
    const screen = await render(
      withRouter(
        <AuthorCard author={author} state={state} libraries={mockLibraries} {...defaultHandlers} />,
      ),
    );
    await expect.element(screen.getByText("Not in library")).toBeVisible();
  });

  it("filters dismissed works", async () => {
    const state: AuthorAvailState = {
      status: "done",
      olKey: "OL7313085A",
      resolvedName: "Adrian Tchaikovsky",
      works: [
        makeWork(),
        makeWork({ title: "Dismissed Book", olWorkKey: "/works/OL99W", libbyResults: [] }),
      ],
      fetchedAt: Date.now(),
    };
    const screen = await render(
      withRouter(
        <AuthorCard
          author={author}
          state={state}
          libraries={mockLibraries}
          {...defaultHandlers}
          isWorkDismissed={(w) => w.olWorkKey === "/works/OL99W"}
        />,
      ),
    );
    expect(screen.container.textContent).not.toContain("Dismissed Book");
  });

  it("shows 'Now' badge for available works", async () => {
    const state: AuthorAvailState = {
      status: "done",
      olKey: "OL7313085A",
      resolvedName: "Adrian Tchaikovsky",
      works: [makeWork()],
      fetchedAt: Date.now(),
    };
    const screen = await render(
      withRouter(
        <AuthorCard author={author} state={state} libraries={mockLibraries} {...defaultHandlers} />,
      ),
    );
    await expect.element(screen.getByText("Now")).toBeVisible();
  });
});
