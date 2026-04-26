import { describe, it, expect, vi } from "vitest";
import { render } from "vitest-browser-react";
import { MemoryRouter } from "react-router";

const mockGetBooks = vi.fn().mockReturnValue([]);
const mockGetLibraries = vi.fn().mockReturnValue([]);

vi.mock("~/lib/storage", () => ({
  getBooks: (...args: unknown[]) => mockGetBooks(...args),
  getLibraries: (...args: unknown[]) => mockGetLibraries(...args),
}));

const { default: Home, meta, clientLoader } = await import("./route");

describe("Home", () => {
  it("renders the ShelfCheck heading", async () => {
    const screen = await render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );
    await expect.element(screen.getByRole("heading", { name: "ShelfCheck" })).toBeVisible();
  });

  it("renders the Get Started link", async () => {
    const screen = await render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );
    await expect.element(screen.getByText("Get Started")).toBeVisible();
  });

  it("renders the How it works section", async () => {
    const screen = await render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );
    await expect.element(screen.getByText("How it works")).toBeVisible();
  });

  it("renders the Your data, your choice section", async () => {
    const screen = await render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );
    await expect.element(screen.getByText("Your data, your choice")).toBeVisible();
  });

  it("mentions ATproto and ATmosphere", async () => {
    const screen = await render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );
    await expect.element(screen.getByRole("link", { name: "ATproto" })).toBeVisible();
    await expect.element(screen.getByRole("link", { name: "ATmosphere" })).toBeVisible();
  });
});

describe("meta", () => {
  it("returns title and description", () => {
    const result = meta();
    expect(result[0].title).toContain("ShelfCheck");
    expect(result[1].name).toBe("description");
    expect(result[1].content).toContain("ATproto");
  });
});

describe("clientLoader", () => {
  it("returns null when no books or libraries", () => {
    mockGetBooks.mockReturnValue([]);
    mockGetLibraries.mockReturnValue([]);
    expect(clientLoader()).toBeNull();
  });

  it("throws redirect when books and libraries exist", () => {
    mockGetBooks.mockReturnValue([{ id: "1" }]);
    mockGetLibraries.mockReturnValue([{ key: "lib1" }]);
    expect(() => clientLoader()).toThrow();
  });

  it("returns null when only books exist", () => {
    mockGetBooks.mockReturnValue([{ id: "1" }]);
    mockGetLibraries.mockReturnValue([]);
    expect(clientLoader()).toBeNull();
  });

  it("returns null when only libraries exist", () => {
    mockGetBooks.mockReturnValue([]);
    mockGetLibraries.mockReturnValue([{ key: "lib1" }]);
    expect(clientLoader()).toBeNull();
  });
});
