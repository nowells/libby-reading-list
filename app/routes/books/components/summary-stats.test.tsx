import { describe, it, expect, vi } from "vitest";
import { render } from "vitest-browser-react";
import { componentLocator } from "~/test/screenshot";
import { SummaryStats } from "./summary-stats";

describe("SummaryStats", () => {
  const baseProps = {
    available: 5,
    soon: 3,
    waiting: 8,
    notFound: 2,
    activeCategory: null,
    onToggleCategory: vi.fn(),
  };

  it("renders all four stat categories", async () => {
    const screen = await render(<SummaryStats {...baseProps} />);
    await expect.element(screen.getByText("5")).toBeVisible();
    await expect.element(screen.getByText("3")).toBeVisible();
    await expect.element(screen.getByText("8")).toBeVisible();
    await expect.element(screen.getByText("2")).toBeVisible();
    await expect.element(screen.getByText("AVAILABLE")).toBeVisible();
    await expect.element(screen.getByText("SOON")).toBeVisible();
    await expect.element(screen.getByText("WAITING")).toBeVisible();
    await expect.element(screen.getByText("NOT FOUND")).toBeVisible();
  });

  it("calls onToggleCategory when a stat is clicked", async () => {
    const onToggle = vi.fn();
    const screen = await render(<SummaryStats {...baseProps} onToggleCategory={onToggle} />);
    await screen.getByText("AVAILABLE").click();
    expect(onToggle).toHaveBeenCalledWith("available");
  });

  it("highlights active category", async () => {
    const screen = await render(<SummaryStats {...baseProps} activeCategory="available" />);
    const button = screen.getByText("AVAILABLE").element().closest("button")!;
    expect(button.className).toContain("ring");
  });

  it("dims non-active categories when one is active", async () => {
    const screen = await render(<SummaryStats {...baseProps} activeCategory="available" />);
    const waitingButton = screen.getByText("WAITING").element().closest("button")!;
    expect(waitingButton.className).toContain("opacity-50");
  });

  it("summary stats match screenshot", async () => {
    const screen = await render(<SummaryStats {...baseProps} />);
    await expect.element(componentLocator(screen)).toMatchScreenshot("summary-stats");
  });

  it("summary stats with active filter match screenshot", async () => {
    const screen = await render(<SummaryStats {...baseProps} activeCategory="available" />);
    await expect.element(componentLocator(screen)).toMatchScreenshot("summary-stats-active");
  });
});
