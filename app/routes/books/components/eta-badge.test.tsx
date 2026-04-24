import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-react";
import { componentLocator } from "~/test/screenshot";
import { EtaBadge } from "./eta-badge";

describe("EtaBadge", () => {
  it("renders dash for undefined days", async () => {
    const screen = await render(<EtaBadge />);
    expect(screen.container.textContent).toContain("\u2014");
  });

  it("renders green for 7 or fewer days", async () => {
    const screen = await render(<EtaBadge days={5} />);
    await expect.element(screen.getByText("~5d")).toBeVisible();
    const el = screen.getByText("~5d").element();
    expect(el.className).toContain("emerald");
  });

  it("renders blue for 8-14 days (soon threshold)", async () => {
    const screen = await render(<EtaBadge days={10} />);
    await expect.element(screen.getByText("~10d")).toBeVisible();
    const el = screen.getByText("~10d").element();
    expect(el.className).toContain("blue");
  });

  it("renders amber for 15-60 days", async () => {
    const screen = await render(<EtaBadge days={30} />);
    await expect.element(screen.getByText("~30d")).toBeVisible();
    const el = screen.getByText("~30d").element();
    expect(el.className).toContain("amber");
  });

  it("renders red for 61+ days", async () => {
    const screen = await render(<EtaBadge days={90} />);
    await expect.element(screen.getByText("~90d")).toBeVisible();
    const el = screen.getByText("~90d").element();
    expect(el.className).toContain("rose");
  });

  it("ETA badge variants match screenshot", async () => {
    const screen = await render(
      <div style={{ display: "flex", gap: 16 }}>
        <EtaBadge />
        <EtaBadge days={3} />
        <EtaBadge days={10} />
        <EtaBadge days={45} />
        <EtaBadge days={90} />
      </div>,
    );
    await expect.element(componentLocator(screen)).toMatchScreenshot("eta-badge-variants");
  });
});
