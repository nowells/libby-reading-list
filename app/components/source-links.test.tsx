import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-react";
import { SourceLinks } from "./source-links";
import type { Book } from "~/lib/storage";

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: "test-1",
    title: "Test Book",
    author: "Test Author",
    source: "goodreads",
    ...overrides,
  };
}

describe("SourceLinks", () => {
  it("returns null for manual books", async () => {
    const screen = await render(<SourceLinks book={makeBook({ manual: true })} />);
    expect(screen.container.innerHTML).toBe("");
  });

  it("renders Goodreads link for goodreads source", async () => {
    const screen = await render(<SourceLinks book={makeBook({ source: "goodreads" })} />);
    const link = screen.getByRole("link", { name: /Goodreads/i });
    await expect.element(link).toBeVisible();
  });

  it("renders Goodreads and Hardcover for unknown source", async () => {
    const screen = await render(<SourceLinks book={makeBook({ source: "unknown" })} />);
    await expect.element(screen.getByRole("link", { name: /Goodreads/i })).toBeVisible();
    await expect.element(screen.getByRole("link", { name: /Hardcover/i })).toBeVisible();
  });

  it("renders StoryGraph link for storygraph source", async () => {
    const screen = await render(<SourceLinks book={makeBook({ source: "storygraph" })} />);
    await expect.element(screen.getByRole("link", { name: /StoryGraph/i })).toBeVisible();
  });

  it("renders Lyndi label for lyndi source", async () => {
    const screen = await render(<SourceLinks book={makeBook({ source: "lyndi" })} />);
    expect(screen.container.textContent).toContain("Lyndi CSV");
  });

  it("renders Bookhive link for bookhive source", async () => {
    const screen = await render(<SourceLinks book={makeBook({ source: "bookhive" })} />);
    await expect.element(screen.getByRole("link", { name: /Bookhive/i })).toBeVisible();
  });

  it("renders Open Library link when workId is present", async () => {
    const screen = await render(
      <SourceLinks book={makeBook({ workId: "OL12345W" })} />,
    );
    const link = screen.getByRole("link", { name: /Open Library/i });
    await expect.element(link).toBeVisible();
    expect(link.element().getAttribute("href")).toBe("https://openlibrary.org/works/OL12345W");
  });

  it("does not render Open Library link when workId is absent", async () => {
    const screen = await render(<SourceLinks book={makeBook()} />);
    expect(screen.container.textContent).not.toContain("Open Library");
  });

  it("uses sourceUrl when provided for goodreads", async () => {
    const screen = await render(
      <SourceLinks book={makeBook({ source: "goodreads", sourceUrl: "https://custom.url" })} />,
    );
    const link = screen.getByRole("link", { name: /Goodreads/i });
    expect(link.element().getAttribute("href")).toBe("https://custom.url");
  });

  it("uses sourceUrl when provided for storygraph", async () => {
    const screen = await render(
      <SourceLinks book={makeBook({ source: "storygraph", sourceUrl: "https://sg.url" })} />,
    );
    const link = screen.getByRole("link", { name: /StoryGraph/i });
    expect(link.element().getAttribute("href")).toBe("https://sg.url");
  });

  it("uses sourceUrl when provided for bookhive", async () => {
    const screen = await render(
      <SourceLinks book={makeBook({ source: "bookhive", sourceUrl: "https://bh.url" })} />,
    );
    const link = screen.getByRole("link", { name: /Bookhive/i });
    expect(link.element().getAttribute("href")).toBe("https://bh.url");
  });

  it("uses sourceUrl when provided for hardcover", async () => {
    const screen = await render(
      <SourceLinks book={makeBook({ source: "unknown", sourceUrl: "https://hc.url" })} />,
    );
    const link = screen.getByRole("link", { name: /Hardcover/i });
    expect(link.element().getAttribute("href")).toBe("https://hc.url");
  });

  it("builds search URL for goodreads when no sourceUrl", async () => {
    const screen = await render(
      <SourceLinks book={makeBook({ source: "goodreads", title: "My Book", author: "Jane" })} />,
    );
    const link = screen.getByRole("link", { name: /Goodreads/i });
    expect(link.element().getAttribute("href")).toContain("goodreads.com/search");
    expect(link.element().getAttribute("href")).toContain("My%20Book%20Jane");
  });
});
