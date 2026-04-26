import { describe, it, expect, vi, beforeEach } from "vitest";
import { useMemo } from "react";
import { render } from "vitest-browser-react";
import { useAvailabilityChecker } from "./use-availability-checker";
import { mockBooks, mockLibraries, mockAvailability } from "~/test/msw/data";
import type { BookAvailability } from "~/lib/libby";
import type { Book, LibraryConfig } from "~/lib/storage";

function delay<T>(value: T, ms = 10): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

vi.mock("~/lib/libby", () => ({
  findBookInLibrary: vi.fn().mockImplementation(() =>
    delay({
      bookTitle: "Children of Time",
      bookAuthor: "Adrian Tchaikovsky",
      results: [],
    } as BookAvailability),
  ),
}));

vi.mock("~/lib/openlibrary", () => ({
  getWorkEditionIsbns: vi.fn().mockImplementation(() => delay([])),
  enrichBooksWithWorkId: vi.fn().mockImplementation((books: any[]) => delay(books)),
}));

vi.mock("~/lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/storage")>();
  return {
    ...actual,
    updateBook: vi.fn(),
  };
});

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
});

function TestHarness({
  books: booksProp,
  libraries: librariesProp,
}: {
  books?: Book[];
  libraries?: LibraryConfig[];
}) {
  const books = useMemo(() => booksProp ?? mockBooks.slice(0, 1), [booksProp]);
  const libraries = useMemo(() => librariesProp ?? mockLibraries.slice(0, 1), [librariesProp]);
  const result = useAvailabilityChecker(books, libraries);
  return (
    <div>
      <div data-testid="total">{result.totalBooks}</div>
      <div data-testid="checked">{result.checkedCount}</div>
      <div data-testid="loading">{result.loadingCount}</div>
      <div data-testid="oldest">{result.oldestFetchedAt ?? "null"}</div>
      {Object.entries(result.availMap).map(([id, state]) => (
        <div key={id} data-testid={`status-${id}`}>
          {state.status}
        </div>
      ))}
      <button data-testid="refresh-all" onClick={result.refreshAll}>
        Refresh All
      </button>
      <button data-testid="refresh-book" onClick={() => result.refreshBook(books[0])}>
        Refresh Book
      </button>
    </div>
  );
}

describe("useAvailabilityChecker", () => {
  it("initializes with correct total book count", async () => {
    const screen = await render(<TestHarness books={mockBooks} />);
    await expect.element(screen.getByTestId("total")).toHaveTextContent("3");
  });

  it("fetches availability and transitions to done", async () => {
    const screen = await render(<TestHarness />);

    await vi.waitFor(
      async () => {
        await expect.element(screen.getByTestId("checked")).toHaveTextContent("1");
      },
      { timeout: 5000 },
    );
  });

  it("reports status per book", async () => {
    const screen = await render(<TestHarness />);

    await vi.waitFor(
      async () => {
        await expect
          .element(screen.getByTestId(`status-${mockBooks[0].id}`))
          .toHaveTextContent("done");
      },
      { timeout: 5000 },
    );
  });

  it("handles findBookInLibrary errors gracefully", async () => {
    const { findBookInLibrary } = await import("~/lib/libby");
    vi.mocked(findBookInLibrary).mockRejectedValue(new Error("Network error"));

    const screen = await render(<TestHarness />);

    await vi.waitFor(
      async () => {
        await expect.element(screen.getByTestId("checked")).toHaveTextContent("1");
      },
      { timeout: 5000 },
    );
  });

  it("reports oldestFetchedAt after fetch completes", async () => {
    const screen = await render(<TestHarness />);

    await vi.waitFor(
      async () => {
        const text = screen.getByTestId("oldest").element().textContent;
        expect(text).not.toBe("null");
        expect(Number(text)).toBeGreaterThan(0);
      },
      { timeout: 5000 },
    );
  });

  it("refreshAll triggers re-fetch", async () => {
    const screen = await render(<TestHarness />);

    await vi.waitFor(
      async () => {
        await expect.element(screen.getByTestId("checked")).toHaveTextContent("1");
      },
      { timeout: 5000 },
    );

    sessionStorage.clear();
    await screen.getByTestId("refresh-all").click();

    await vi.waitFor(
      async () => {
        await expect.element(screen.getByTestId("checked")).toHaveTextContent("1");
      },
      { timeout: 5000 },
    );
  });

  it("refreshBook triggers single book re-fetch", async () => {
    const screen = await render(<TestHarness />);

    await vi.waitFor(
      async () => {
        await expect.element(screen.getByTestId("checked")).toHaveTextContent("1");
      },
      { timeout: 5000 },
    );

    await screen.getByTestId("refresh-book").click();

    await vi.waitFor(
      async () => {
        await expect.element(screen.getByTestId("checked")).toHaveTextContent("1");
      },
      { timeout: 5000 },
    );
  });

  it("enriches books missing workId on refresh", async () => {
    const { enrichBooksWithWorkId } = await import("~/lib/openlibrary");
    const bookWithoutWorkId = { ...mockBooks[0], workId: undefined };

    const screen = await render(<TestHarness books={[bookWithoutWorkId]} />);

    await vi.waitFor(
      async () => {
        await expect.element(screen.getByTestId("checked")).toHaveTextContent("1");
      },
      { timeout: 5000 },
    );

    expect(enrichBooksWithWorkId).toHaveBeenCalled();
  });
});
