import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-react";
import { CoverImage } from "./cover-image";

describe("CoverImage", () => {
  it("renders fallback SVG when no src is provided", async () => {
    const screen = await render(<CoverImage alt="Test book" />);
    const svg = screen.container.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("renders img when src is provided", async () => {
    const screen = await render(<CoverImage src="https://example.com/cover.jpg" alt="Test book" />);
    const img = screen.container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("https://example.com/cover.jpg");
    expect(img!.getAttribute("alt")).toBe("Test book");
  });

  it("renders fallback after image error", async () => {
    const screen = await render(<CoverImage src="https://example.com/bad.jpg" alt="Test book" />);
    const img = screen.container.querySelector("img");
    expect(img).not.toBeNull();

    // Trigger error event
    img!.dispatchEvent(new Event("error"));

    // After error, should show the fallback SVG
    await expect.poll(() => screen.container.querySelector("svg")).not.toBeNull();
  });
});
