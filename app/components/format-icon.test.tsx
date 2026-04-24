import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-react";
import { componentLocator } from "~/test/screenshot";
import { FormatIcon } from "./format-icon";

describe("FormatIcon", () => {
  it("renders ebook icon", async () => {
    const screen = await render(<FormatIcon type="ebook" />);
    expect(screen.container.querySelector("svg")).not.toBeNull();
  });

  it("renders audiobook icon", async () => {
    const screen = await render(<FormatIcon type="audiobook" />);
    expect(screen.container.querySelector("svg")).not.toBeNull();
  });

  it("defaults to audiobook icon for unknown types", async () => {
    const screen = await render(<FormatIcon type="unknown" />);
    expect(screen.container.querySelector("svg")).not.toBeNull();
  });

  it("ebook icon matches screenshot", async () => {
    const screen = await render(<FormatIcon type="ebook" />);
    await expect.element(componentLocator(screen)).toMatchScreenshot("format-icon-ebook");
  });

  it("audiobook icon matches screenshot", async () => {
    const screen = await render(<FormatIcon type="audiobook" />);
    await expect.element(componentLocator(screen)).toMatchScreenshot("format-icon-audiobook");
  });
});
