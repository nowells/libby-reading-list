import { describe, it, expect, beforeEach } from "vitest";
import { render } from "vitest-browser-react";
import { MemoryRouter, Routes, Route } from "react-router";
import { componentLocator } from "~/test/screenshot";
import BookDetails, { clientLoader } from "./route";
import { mockLibraries } from "~/test/msw/data";

function setLibraries() {
  localStorage.setItem("shelfcheck:libraries", JSON.stringify(mockLibraries));
}

function renderRoute(workId: string) {
  return render(
    <MemoryRouter initialEntries={[`/book/${workId}`]}>
      <Routes>
        <Route path="/book/:workId" element={<BookDetails />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("BookDetails clientLoader", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("redirects to /setup when no libraries are configured", () => {
    expect(() => clientLoader()).toThrow();
  });

  it("returns the libraries when configured", () => {
    setLibraries();
    const data = clientLoader();
    expect(data?.libraries.length).toBeGreaterThan(0);
  });
});

describe("BookDetails", () => {
  beforeEach(() => {
    localStorage.clear();
    setLibraries();
  });

  it("shows the invalid-id state for an unparseable workId", async () => {
    const screen = await renderRoute("not-a-real-id");
    await expect.element(screen.getByText("Invalid book identifier")).toBeVisible();
  });

  it("renders the title once Open Library responds", async () => {
    const screen = await renderRoute("OL17823492W");
    await expect.element(screen.getByText("Children of Time")).toBeVisible();
  });

  it("shows the description after fetch", async () => {
    const screen = await renderRoute("OL17823492W");
    await expect
      .element(screen.getByText(/mind-expanding sci-fi epic/i, { exact: false }))
      .toBeVisible();
  });

  it("shows subjects pulled from Open Library", async () => {
    const screen = await renderRoute("OL17823492W");
    await expect.element(screen.getByText("Science Fiction")).toBeVisible();
  });

  it("shows the rating average from /ratings.json", async () => {
    const screen = await renderRoute("OL17823492W");
    await expect.element(screen.getByText(/4\.32/)).toBeVisible();
  });

  it("renders the 'Want to read' action when the book isn't on the list", async () => {
    const screen = await renderRoute("OL17823492W");
    await expect.element(screen.getByText("Want to read")).toBeVisible();
  });

  it("book details page matches screenshot", async () => {
    const screen = await renderRoute("OL17823492W");
    // Wait for at least the title to be visible so the screenshot is stable.
    await expect.element(screen.getByText("Children of Time")).toBeVisible();
    await expect.element(componentLocator(screen)).toMatchScreenshot("book-details");
  });
});
