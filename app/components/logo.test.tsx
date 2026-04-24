import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-react";
import { Logo } from "./logo";

describe("Logo", () => {
  it("renders an SVG element", async () => {
    const screen = await render(<Logo />);
    const svg = screen.container.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("applies default className", async () => {
    const screen = await render(<Logo />);
    const svg = screen.container.querySelector("svg");
    expect(svg?.getAttribute("class")).toContain("w-10 h-10");
  });

  it("applies custom className", async () => {
    const screen = await render(<Logo className="w-20 h-20" />);
    const svg = screen.container.querySelector("svg");
    expect(svg?.getAttribute("class")).toContain("w-20 h-20");
  });
});
