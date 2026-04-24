import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-react";
import { http, HttpResponse } from "msw";
import { worker } from "~/test/setup";
import { componentLocator } from "~/test/screenshot";
import { LibraryIcon, LibraryName } from "./library-icon";
import { mockLibraries } from "~/test/msw/data";

describe("LibraryIcon", () => {
  it("renders logo image when library has a logoUrl", async () => {
    const screen = await render(<LibraryIcon libraryKey="lapl" libraries={mockLibraries} />);
    const img = screen.getByRole("img");
    await expect.element(img).toHaveAttribute("src", "https://example.com/lapl-logo.png");
    await expect.element(img).toHaveAttribute("alt", "Los Angeles Public Library");
  });

  it("renders initial letter when library has no logoUrl", async () => {
    const screen = await render(<LibraryIcon libraryKey="nypl" libraries={mockLibraries} />);
    await expect.element(screen.getByText("N")).toBeVisible();
  });

  it("renders L fallback for unknown library key", async () => {
    const screen = await render(<LibraryIcon libraryKey="unknown" libraries={mockLibraries} />);
    await expect.element(screen.getByText("L")).toBeVisible();
  });

  it("applies custom className", async () => {
    const screen = await render(
      <LibraryIcon libraryKey="lapl" libraries={mockLibraries} className="custom-class" />,
    );
    const img = screen.container.querySelector("img");
    expect(img?.className).toBe("custom-class");
  });

  it("library icon with logo matches screenshot", async () => {
    const screen = await render(<LibraryIcon libraryKey="lapl" libraries={mockLibraries} />);
    await expect.element(componentLocator(screen)).toMatchScreenshot("library-icon-logo");
  });

  it("library icon with initial matches screenshot", async () => {
    const screen = await render(<LibraryIcon libraryKey="nypl" libraries={mockLibraries} />);
    await expect.element(componentLocator(screen)).toMatchScreenshot("library-icon-initial");
  });

  it("falls back to initial letter when logo image fails to load", async () => {
    worker.use(
      http.get("https://example.com/lapl-logo.png", () => {
        return new HttpResponse(null, { status: 404 });
      }),
    );
    const screen = await render(<LibraryIcon libraryKey="lapl" libraries={mockLibraries} />);
    // After the image fails, it should fall back to the initial letter
    await expect.element(screen.getByText("L")).toBeVisible();
  });
});

describe("LibraryName", () => {
  it("renders library name for known key", async () => {
    const screen = await render(<LibraryName libraryKey="lapl" libraries={mockLibraries} />);
    await expect.element(screen.getByText("Los Angeles Public Library")).toBeVisible();
  });

  it("renders key as fallback for unknown library", async () => {
    const screen = await render(<LibraryName libraryKey="unknown-lib" libraries={mockLibraries} />);
    await expect.element(screen.getByText("unknown-lib")).toBeVisible();
  });
});
