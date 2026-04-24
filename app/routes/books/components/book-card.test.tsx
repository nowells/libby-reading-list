import { describe, it, expect, vi } from "vitest";
import { render } from "vitest-browser-react";
import { componentLocator } from "~/test/screenshot";
import { BookCard } from "./book-card";
import { mockBooks, mockLibraries, mockAvailability } from "~/test/msw/data";
import type { BookAvailState } from "../lib/categorize";

const defaultHandlers = {
  onRefresh: vi.fn(),
  onLibbyClick: vi.fn(),
  onRemove: vi.fn(),
  onMarkRead: vi.fn(),
  onFollowAuthor: vi.fn(),
  isRead: false,
  isAuthorFollowed: false,
};

describe("BookCard", () => {
  it("renders loading state", async () => {
    const state: BookAvailState = { status: "pending" };
    const screen = await render(
      <BookCard
        book={mockBooks[0]}
        state={state}
        libraries={mockLibraries}
        formatFilter="all"
        {...defaultHandlers}
      />,
    );
    await expect.element(screen.getByText("Children of Time")).toBeVisible();
    await expect.element(screen.getByText("Checking")).toBeVisible();
  });

  it("renders available state with results", async () => {
    const state: BookAvailState = {
      status: "done",
      data: mockAvailability,
      fetchedAt: Date.now(),
    };
    const screen = await render(
      <BookCard
        book={mockBooks[0]}
        state={state}
        libraries={mockLibraries}
        formatFilter="all"
        {...defaultHandlers}
      />,
    );
    await expect.element(screen.getByText("Children of Time")).toBeVisible();
    await expect.element(screen.getByText("Adrian Tchaikovsky")).toBeVisible();
  });

  it("renders not-found state", async () => {
    const state: BookAvailState = {
      status: "done",
      data: { bookTitle: "Dune", bookAuthor: "Frank Herbert", results: [] },
      fetchedAt: Date.now(),
    };
    const screen = await render(
      <BookCard
        book={mockBooks[1]}
        state={state}
        libraries={mockLibraries}
        formatFilter="all"
        {...defaultHandlers}
      />,
    );
    expect(screen.container.textContent).toContain("Dune");
  });

  it("renders read state with badge", async () => {
    const state: BookAvailState = {
      status: "done",
      data: mockAvailability,
      fetchedAt: Date.now(),
    };
    const screen = await render(
      <BookCard
        book={mockBooks[0]}
        state={state}
        libraries={mockLibraries}
        formatFilter="all"
        {...defaultHandlers}
        isRead={true}
      />,
    );
    await expect.element(screen.getByText("Read", { exact: true })).toBeVisible();
  });

  it("book card loading matches screenshot", async () => {
    const state: BookAvailState = { status: "pending" };
    const screen = await render(
      <BookCard
        book={mockBooks[0]}
        state={state}
        libraries={[mockLibraries[0]]}
        formatFilter="all"
        {...defaultHandlers}
      />,
    );
    await expect.element(componentLocator(screen)).toMatchScreenshot("book-card-loading");
  });

  it("book card with results matches screenshot", async () => {
    const state: BookAvailState = {
      status: "done",
      data: mockAvailability,
      fetchedAt: Date.now(),
    };
    const screen = await render(
      <BookCard
        book={mockBooks[0]}
        state={state}
        libraries={[mockLibraries[0]]}
        formatFilter="all"
        {...defaultHandlers}
      />,
    );
    await expect.element(componentLocator(screen)).toMatchScreenshot("book-card-available");
  });

  it("book card not-found matches screenshot", async () => {
    const state: BookAvailState = {
      status: "done",
      data: { bookTitle: "Dune", bookAuthor: "Frank Herbert", results: [] },
      fetchedAt: Date.now(),
    };
    const screen = await render(
      <BookCard
        book={mockBooks[1]}
        state={state}
        libraries={[mockLibraries[0]]}
        formatFilter="all"
        {...defaultHandlers}
      />,
    );
    await expect.element(componentLocator(screen)).toMatchScreenshot("book-card-not-found");
  });
});
