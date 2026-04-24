import { describe, it, expect, vi } from "vitest";
import { render } from "vitest-browser-react";
import { componentLocator } from "~/test/screenshot";
import { ProgressBar } from "./progress-bar";

describe("ProgressBar", () => {
  it("returns null when total is 0", async () => {
    const screen = await render(
      <ProgressBar
        checked={0}
        total={0}
        loading={0}
        oldestFetchedAt={null}
        onRefreshAll={vi.fn()}
      />,
    );
    expect(screen.container.innerHTML).toBe("");
  });

  it("shows checking progress", async () => {
    const screen = await render(
      <ProgressBar
        checked={5}
        total={20}
        loading={3}
        oldestFetchedAt={null}
        onRefreshAll={vi.fn()}
      />,
    );
    await expect.element(screen.getByText("Checking availability... 5 / 20")).toBeVisible();
    await expect.element(screen.getByText("25%")).toBeVisible();
  });

  it("shows enrichment progress when provided", async () => {
    const screen = await render(
      <ProgressBar
        checked={0}
        total={20}
        loading={0}
        oldestFetchedAt={null}
        onRefreshAll={vi.fn()}
        enrichmentProgress={{ done: 10, total: 20 }}
      />,
    );
    await expect.element(screen.getByText("Enriching from Open Library... 10 / 20")).toBeVisible();
    await expect.element(screen.getByText("50%")).toBeVisible();
  });

  it("shows done state with refresh button", async () => {
    const onRefresh = vi.fn();
    const screen = await render(
      <ProgressBar
        checked={10}
        total={10}
        loading={0}
        oldestFetchedAt={Date.now() - 60000}
        onRefreshAll={onRefresh}
      />,
    );
    await expect.element(screen.getByText("Checked all 10 books")).toBeVisible();
    const refreshButton = screen.getByText("Refresh All");
    await expect.element(refreshButton).toBeVisible();
    await refreshButton.click();
    expect(onRefresh).toHaveBeenCalled();
  });

  it("progress bar in-progress matches screenshot", async () => {
    const screen = await render(
      <ProgressBar
        checked={7}
        total={20}
        loading={2}
        oldestFetchedAt={null}
        onRefreshAll={vi.fn()}
      />,
    );
    await expect.element(componentLocator(screen)).toMatchScreenshot("progress-bar-loading");
  });

  it("progress bar complete matches screenshot", async () => {
    const screen = await render(
      <ProgressBar
        checked={20}
        total={20}
        loading={0}
        oldestFetchedAt={Date.now()}
        onRefreshAll={vi.fn()}
      />,
    );
    await expect.element(componentLocator(screen)).toMatchScreenshot("progress-bar-done");
  });
});
