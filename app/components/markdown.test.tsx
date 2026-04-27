import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-react";
import { Markdown, truncateMarkdown } from "./markdown";

describe("Markdown", () => {
  it("renders inline links as anchor tags", async () => {
    const screen = await render(
      <Markdown source="See [Open Library](https://openlibrary.org) for more." />,
    );
    const link = screen.container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("https://openlibrary.org");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link?.textContent).toBe("Open Library");
  });

  it("resolves reference-style links", async () => {
    const source = "Citation needed[1].\n\n[1]: https://en.wikipedia.org/wiki/Test";
    const screen = await render(<Markdown source={source} />);
    const link = screen.container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://en.wikipedia.org/wiki/Test");
  });

  it("renders horizontal rules from `---`", async () => {
    const screen = await render(<Markdown source={"Above\n\n----------\n\nBelow"} />);
    expect(screen.container.querySelector("hr")).not.toBeNull();
  });

  it("strips raw HTML tags but keeps their text content", async () => {
    const screen = await render(<Markdown source="Text with <sup>note</sup> inside." />);
    expect(screen.container.querySelector("sup")).toBeNull();
    expect(screen.container.textContent).toContain("Text with note inside.");
  });

  it("does not render script tags from the source", async () => {
    const screen = await render(<Markdown source={"Hello <script>danger</script> world"} />);
    expect(screen.container.querySelector("script")).toBeNull();
  });

  it("renders bullet lists", async () => {
    const screen = await render(<Markdown source={"- one\n- two\n- three"} />);
    const items = screen.container.querySelectorAll("li");
    expect(items.length).toBe(3);
  });

  it("renders bold and italic text", async () => {
    const screen = await render(<Markdown source="**bold** and *italic*" />);
    expect(screen.container.querySelector("strong")?.textContent).toBe("bold");
    expect(screen.container.querySelector("em")?.textContent).toBe("italic");
  });
});

describe("truncateMarkdown", () => {
  it("returns the input unchanged when shorter than the limit", () => {
    expect(truncateMarkdown("short", 100)).toBe("short");
  });

  it("breaks on a paragraph boundary when one exists before the limit", () => {
    const source = "First paragraph.\n\nSecond paragraph that pushes past the limit.";
    const result = truncateMarkdown(source, 30);
    expect(result).toBe("First paragraph.…");
  });

  it("falls back to a line break when no paragraph break is available", () => {
    const source = "Line one with words\nLine two has padding to overflow";
    const result = truncateMarkdown(source, 25);
    expect(result).toBe("Line one with words…");
  });

  it("falls back to a word boundary when no newlines are available", () => {
    const source = "one two three four five six seven eight nine ten";
    const result = truncateMarkdown(source, 20);
    expect(result).toBe("one two three four…");
  });

  it("does not truncate inside a markdown link when a paragraph break is available", () => {
    const source = "Intro paragraph here.\n\n[label](https://example.com/long-url-path-here)";
    const result = truncateMarkdown(source, 35);
    expect(result).not.toContain("[label]");
    expect(result).toBe("Intro paragraph here.…");
  });
});
