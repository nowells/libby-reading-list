import { describe, it, expect, afterEach } from "vitest";
import { render } from "vitest-browser-react";
import { useTheme } from "./theme";

function TestHarness() {
  const { theme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="current">{theme}</span>
      <button onClick={() => setTheme("dark")}>Dark</button>
      <button onClick={() => setTheme("light")}>Light</button>
      <button onClick={() => setTheme("system")}>System</button>
    </div>
  );
}

describe("useTheme", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
  });

  it("defaults to system when nothing stored", async () => {
    const screen = await render(<TestHarness />);
    await expect.element(screen.getByTestId("current")).toHaveTextContent("system");
  });

  it("persists theme to localStorage", async () => {
    const screen = await render(<TestHarness />);
    await screen.getByText("Dark").click();
    await expect.element(screen.getByTestId("current")).toHaveTextContent("dark");
    expect(localStorage.getItem("shelfcheck:theme")).toBe("dark");
  });

  it("applies dark class to documentElement", async () => {
    const screen = await render(<TestHarness />);
    await screen.getByText("Dark").click();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("removes dark class when set to light", async () => {
    const screen = await render(<TestHarness />);
    await screen.getByText("Dark").click();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    await screen.getByText("Light").click();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("restores stored theme on mount", async () => {
    localStorage.setItem("shelfcheck:theme", "dark");
    const screen = await render(<TestHarness />);
    await expect.element(screen.getByTestId("current")).toHaveTextContent("dark");
  });

  it("ignores invalid stored values", async () => {
    localStorage.setItem("shelfcheck:theme", "invalid-value");
    const screen = await render(<TestHarness />);
    await expect.element(screen.getByTestId("current")).toHaveTextContent("system");
  });
});
