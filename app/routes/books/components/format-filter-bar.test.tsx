import { describe, it, expect, vi } from "vitest";
import { render } from "vitest-browser-react";
import { componentLocator } from "~/test/screenshot";
import { FormatFilterBar } from "./format-filter-bar";

describe("FormatFilterBar", () => {
  it("renders all three filter options", async () => {
    const screen = await render(<FormatFilterBar active="all" onToggle={vi.fn()} />);
    await expect.element(screen.getByText("All")).toBeVisible();
    await expect.element(screen.getByText("eBooks")).toBeVisible();
    await expect.element(screen.getByText("Audiobooks")).toBeVisible();
  });

  it("highlights the active filter", async () => {
    const screen = await render(<FormatFilterBar active="ebook" onToggle={vi.fn()} />);
    const ebookButton = screen.getByText("eBooks").element().closest("button")!;
    expect(ebookButton.className).toContain("bg-gray-900");
  });

  it("calls onToggle when a filter is clicked", async () => {
    const onToggle = vi.fn();
    const screen = await render(<FormatFilterBar active="all" onToggle={onToggle} />);
    await screen.getByText("Audiobooks").click();
    expect(onToggle).toHaveBeenCalledWith("audiobook");
  });

  it("format filter bar matches screenshot", async () => {
    const screen = await render(<FormatFilterBar active="ebook" onToggle={vi.fn()} />);
    await expect.element(componentLocator(screen)).toMatchScreenshot("format-filter-bar");
  });
});
