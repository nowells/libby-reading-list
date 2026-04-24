import { describe, it, expect, afterEach } from "vitest";
import { render } from "vitest-browser-react";
import { ThemeSelector } from "./theme-selector";

describe("ThemeSelector", () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  it("renders all three theme options", async () => {
    const screen = await render(<ThemeSelector />);
    await expect.element(screen.getByTitle("Light")).toBeInTheDocument();
    await expect.element(screen.getByTitle("System")).toBeInTheDocument();
    await expect.element(screen.getByTitle("Dark")).toBeInTheDocument();
  });

  it("switches to dark theme on click", async () => {
    const screen = await render(<ThemeSelector />);
    await screen.getByTitle("Dark").click();
    expect(localStorage.getItem("shelfcheck:theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("switches to light theme on click", async () => {
    localStorage.setItem("shelfcheck:theme", "dark");
    const screen = await render(<ThemeSelector />);
    await screen.getByTitle("Light").click();
    expect(localStorage.getItem("shelfcheck:theme")).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("switches to system theme on click", async () => {
    localStorage.setItem("shelfcheck:theme", "dark");
    const screen = await render(<ThemeSelector />);
    await screen.getByTitle("System").click();
    expect(localStorage.getItem("shelfcheck:theme")).toBe("system");
  });
});
