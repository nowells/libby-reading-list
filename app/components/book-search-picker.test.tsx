import { describe, it, expect, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { BookSearchPicker } from "./book-search-picker";
import { worker } from "~/test/setup";
import { http, HttpResponse } from "msw";

const searchResults = {
  items: [
    {
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
    {
      id: "media-2",
      title: "Children of Ruin",
      sortTitle: "children of ruin",
      type: { id: "ebook", name: "eBook" },
      formats: [{ id: "ebook-overdrive", name: "OverDrive Read" }],
      creators: [{ name: "Adrian Tchaikovsky", role: "Author" }],
      publisher: { id: "pub-1", name: "Publisher" },
      publishDate: "2019-05-14",
      isAvailable: false,
      ownedCopies: 3,
      availableCopies: 0,
      holdsCount: 5,
    },
  ],
};

describe("BookSearchPicker", () => {
  it("renders search input with placeholder", async () => {
    const screen = await render(
      <BookSearchPicker onSelect={vi.fn()} placeholder="Find a book..." />,
    );
    await expect.element(page.getByPlaceholder("Find a book...")).toBeVisible();
  });

  it("renders default placeholder", async () => {
    const screen = await render(<BookSearchPicker onSelect={vi.fn()} />);
    await expect.element(page.getByPlaceholder("Search for a book...")).toBeVisible();
  });

  it("shows cancel button when onCancel is provided", async () => {
    const onCancel = vi.fn();
    const screen = await render(<BookSearchPicker onSelect={vi.fn()} onCancel={onCancel} />);
    await expect.element(screen.getByText("Cancel")).toBeVisible();
    await screen.getByText("Cancel").click();
    expect(onCancel).toHaveBeenCalled();
  });

  it("does not show cancel button when onCancel is not provided", async () => {
    const screen = await render(<BookSearchPicker onSelect={vi.fn()} />);
    expect(screen.container.textContent).not.toContain("Cancel");
  });

  it("searches and displays results", async () => {
    worker.use(
      http.get("https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media", () => {
        return HttpResponse.json(searchResults);
      }),
    );

    const screen = await render(<BookSearchPicker onSelect={vi.fn()} />);
    const input = page.getByPlaceholder("Search for a book...");
    await input.fill("Children of");

    // Wait for debounced search results
    await expect.element(screen.getByText("Children of Time")).toBeVisible();
    await expect.element(screen.getByText("Children of Ruin")).toBeVisible();
  });

  it("calls onSelect when a result is clicked", async () => {
    worker.use(
      http.get("https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media", () => {
        return HttpResponse.json(searchResults);
      }),
    );

    const onSelect = vi.fn();
    const screen = await render(<BookSearchPicker onSelect={onSelect} />);
    const input = page.getByPlaceholder("Search for a book...");
    await input.fill("Children of");

    await expect.element(screen.getByText("Children of Time")).toBeVisible();
    await screen.getByText("Children of Time").click();
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "media-1", title: "Children of Time" }),
    );
  });

  it("shows 'No books found' for empty results", async () => {
    worker.use(
      http.get("https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media", () => {
        return HttpResponse.json({ items: [] });
      }),
    );

    const screen = await render(<BookSearchPicker onSelect={vi.fn()} />);
    const input = page.getByPlaceholder("Search for a book...");
    await input.fill("xyznonexistent");

    await expect.element(screen.getByText("No books found. Try a different search.")).toBeVisible();
  });

  it("marks existing books as already added", async () => {
    worker.use(
      http.get("https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media", () => {
        return HttpResponse.json(searchResults);
      }),
    );

    const existingBooks = [{ title: "Children of Time", author: "Adrian Tchaikovsky" }];
    const onSelect = vi.fn();
    const screen = await render(
      <BookSearchPicker onSelect={onSelect} existingBooks={existingBooks} />,
    );

    const input = page.getByPlaceholder("Search for a book...");
    await input.fill("Children of");

    await expect.element(screen.getByText("Children of Time")).toBeVisible();
    // The button for an existing book should be disabled
    const button = screen.getByText("Children of Time").element().closest("button")!;
    expect(button.disabled).toBe(true);
  });

  it("performs initial search when initialQuery is provided", async () => {
    worker.use(
      http.get("https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media", () => {
        return HttpResponse.json(searchResults);
      }),
    );

    const screen = await render(<BookSearchPicker onSelect={vi.fn()} initialQuery="Children" />);

    await expect.element(screen.getByText("Children of Time")).toBeVisible();
  });

  it("does not search for queries shorter than 2 characters", async () => {
    let searchCalled = false;
    worker.use(
      http.get("https://thunder.api.overdrive.com/v2/libraries/:libraryKey/media", () => {
        searchCalled = true;
        return HttpResponse.json(searchResults);
      }),
    );

    const screen = await render(<BookSearchPicker onSelect={vi.fn()} />);
    const input = page.getByPlaceholder("Search for a book...");
    await input.fill("C");

    // Short delay to ensure debounce would have fired
    await new Promise((r) => setTimeout(r, 500));
    expect(searchCalled).toBe(false);
  });
});
