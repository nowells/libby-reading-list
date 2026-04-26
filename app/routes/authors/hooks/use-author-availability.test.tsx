import { describe, it, expect, vi, beforeEach } from "vitest";
import { useMemo } from "react";
import { render } from "vitest-browser-react";
import { useAuthorAvailability } from "./use-author-availability";
import { mockLibraries } from "~/test/msw/data";
import type { AuthorEntry, LibraryConfig } from "~/lib/storage";

function delay<T>(value: T, ms = 10): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

const testAuthor: AuthorEntry = { id: "author-1", name: "Adrian Tchaikovsky", olKey: "OL7313085A" };

vi.mock("~/lib/openlibrary-author", () => ({
  resolveAuthorKey: vi
    .fn()
    .mockImplementation(() => delay({ key: "OL7313085A", name: "Adrian Tchaikovsky" })),
  getAuthorWorks: vi.fn().mockImplementation(() =>
    delay([
      { key: "/works/OL1W", title: "Children of Time", firstPublishYear: 2015, coverId: 12345 },
      { key: "/works/OL2W", title: "Children of Ruin", firstPublishYear: 2019 },
    ]),
  ),
}));

vi.mock("~/lib/libby", () => ({
  searchLibrary: vi.fn().mockImplementation(() => delay([])),
}));

beforeEach(async () => {
  sessionStorage.clear();
  // Reset call counts but keep implementations
  const olAuthor = await import("~/lib/openlibrary-author");
  vi.mocked(olAuthor.resolveAuthorKey).mockClear();
  vi.mocked(olAuthor.resolveAuthorKey).mockImplementation(() =>
    delay({ key: "OL7313085A", name: "Adrian Tchaikovsky" }),
  );
  vi.mocked(olAuthor.getAuthorWorks).mockClear();
  vi.mocked(olAuthor.getAuthorWorks).mockImplementation(() =>
    delay([
      { key: "/works/OL1W", title: "Children of Time", firstPublishYear: 2015, coverId: 12345 },
      { key: "/works/OL2W", title: "Children of Ruin", firstPublishYear: 2019 },
    ]),
  );
  const libby = await import("~/lib/libby");
  vi.mocked(libby.searchLibrary).mockClear();
  vi.mocked(libby.searchLibrary).mockImplementation(() => delay([]));
});

function TestHarness({
  authors: authorsProp,
  libraries: librariesProp,
}: {
  authors?: AuthorEntry[];
  libraries?: LibraryConfig[];
}) {
  const authors = useMemo(() => authorsProp ?? [testAuthor], [authorsProp]);
  const libraries = useMemo(() => librariesProp ?? mockLibraries.slice(0, 1), [librariesProp]);
  const result = useAuthorAvailability(authors, libraries);
  return (
    <div>
      <div data-testid="checked">{result.checkedCount}</div>
      <div data-testid="loading">{result.loadingCount}</div>
      <div data-testid="oldest">{result.oldestFetchedAt ?? "null"}</div>
      {Object.entries(result.stateMap).map(([id, state]) => (
        <div key={id}>
          <div data-testid={`status-${id}`}>{state.status}</div>
          <div data-testid={`works-${id}`}>{state.works.length}</div>
          <div data-testid={`error-${id}`}>{state.error ?? ""}</div>
          <div data-testid={`olkey-${id}`}>{state.olKey ?? ""}</div>
        </div>
      ))}
      <button data-testid="refresh-all" onClick={result.refreshAll}>
        Refresh All
      </button>
      <button data-testid="refresh-author" onClick={() => result.refreshAuthor(authors[0])}>
        Refresh Author
      </button>
    </div>
  );
}

describe("useAuthorAvailability", () => {
  it("fetches author works and transitions to done", async () => {
    const screen = await render(<TestHarness />);

    await vi.waitFor(
      async () => {
        await expect
          .element(screen.getByTestId(`status-${testAuthor.id}`))
          .toHaveTextContent("done");
      },
      { timeout: 10000 },
    );

    await expect.element(screen.getByTestId(`works-${testAuthor.id}`)).toHaveTextContent("2");
    await expect
      .element(screen.getByTestId(`olkey-${testAuthor.id}`))
      .toHaveTextContent("OL7313085A");
  });

  it("reports checked count", async () => {
    const screen = await render(<TestHarness />);

    await vi.waitFor(
      async () => {
        await expect.element(screen.getByTestId("checked")).toHaveTextContent("1");
      },
      { timeout: 10000 },
    );
  });

  it("handles author not found on Open Library", async () => {
    const { resolveAuthorKey } = await import("~/lib/openlibrary-author");
    vi.mocked(resolveAuthorKey).mockResolvedValue(null);

    const unknownAuthor: AuthorEntry = { id: "a-unknown", name: "Nonexistent Author" };
    const screen = await render(<TestHarness authors={[unknownAuthor]} />);

    await vi.waitFor(
      async () => {
        await expect
          .element(screen.getByTestId(`status-${unknownAuthor.id}`))
          .toHaveTextContent("error");
      },
      { timeout: 10000 },
    );

    await expect
      .element(screen.getByTestId(`error-${unknownAuthor.id}`))
      .toHaveTextContent("Nonexistent Author");
  });

  it("handles API error gracefully", async () => {
    const { getAuthorWorks } = await import("~/lib/openlibrary-author");
    vi.mocked(getAuthorWorks).mockRejectedValue(new Error("Network error"));

    const screen = await render(<TestHarness />);

    await vi.waitFor(
      async () => {
        await expect
          .element(screen.getByTestId(`status-${testAuthor.id}`))
          .toHaveTextContent("error");
      },
      { timeout: 10000 },
    );

    await expect
      .element(screen.getByTestId(`error-${testAuthor.id}`))
      .toHaveTextContent("Network error");
  });

  it("uses olKey from author entry without calling resolveAuthorKey", async () => {
    const { resolveAuthorKey } = await import("~/lib/openlibrary-author");

    const screen = await render(<TestHarness />);

    await vi.waitFor(
      async () => {
        await expect
          .element(screen.getByTestId(`status-${testAuthor.id}`))
          .toHaveTextContent("done");
      },
      { timeout: 10000 },
    );

    // Should NOT have called resolveAuthorKey since olKey was provided
    expect(resolveAuthorKey).not.toHaveBeenCalled();
  });

  it("resolves author key when olKey is not provided", async () => {
    const { resolveAuthorKey } = await import("~/lib/openlibrary-author");

    const authorNoKey: AuthorEntry = { id: "a-nokey", name: "Adrian Tchaikovsky" };
    const screen = await render(<TestHarness authors={[authorNoKey]} />);

    await vi.waitFor(
      async () => {
        await expect
          .element(screen.getByTestId(`status-${authorNoKey.id}`))
          .toHaveTextContent("done");
      },
      { timeout: 10000 },
    );

    expect(resolveAuthorKey).toHaveBeenCalledWith("Adrian Tchaikovsky");
  });
});
