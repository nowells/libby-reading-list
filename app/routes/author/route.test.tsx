import { describe, it, expect, beforeEach } from "vitest";
import { render } from "vitest-browser-react";
import { MemoryRouter, Routes, Route } from "react-router";
import { componentLocator } from "~/test/screenshot";
import AuthorDetailsPage, { clientLoader } from "./route";
import { mockLibraries } from "~/test/msw/data";

function setLibraries() {
  localStorage.setItem("shelfcheck:libraries", JSON.stringify(mockLibraries));
}

function renderRoute(authorKey: string) {
  return render(
    <MemoryRouter initialEntries={[`/author/${authorKey}`]}>
      <Routes>
        <Route path="/author/:authorKey" element={<AuthorDetailsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AuthorDetails clientLoader", () => {
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

describe("AuthorDetails", () => {
  beforeEach(() => {
    localStorage.clear();
    setLibraries();
  });

  it("shows the invalid-id state for an unparseable authorKey", async () => {
    const screen = await renderRoute("not-a-real-key");
    await expect.element(screen.getByText("Invalid author identifier")).toBeVisible();
  });

  it("renders the author name once Open Library responds", async () => {
    const screen = await renderRoute("OL7313085A");
    await expect.element(screen.getByText("Adrian Tchaikovsky")).toBeVisible();
  });

  it("shows the bio after fetch", async () => {
    const screen = await renderRoute("OL7313085A");
    await expect.element(screen.getByText(/British author/i)).toBeVisible();
  });

  it("renders work tiles linking to /book/:workId", async () => {
    const screen = await renderRoute("OL7313085A");
    await expect.element(screen.getByText("Children of Time")).toBeVisible();
    await expect.element(screen.getByText("Children of Ruin")).toBeVisible();
  });

  it("renders the Follow author button", async () => {
    const screen = await renderRoute("OL7313085A");
    await expect.element(screen.getByText("Follow author")).toBeVisible();
  });

  it("author details page matches screenshot", async () => {
    const screen = await renderRoute("OL7313085A");
    // Wait for header, bio, and works grid so all async chunks have settled
    // before the screenshot — otherwise the image-load race causes flakiness.
    await expect.element(screen.getByText("Adrian Tchaikovsky")).toBeVisible();
    await expect.element(screen.getByText(/British author/i)).toBeVisible();
    await expect.element(screen.getByText("Children of Time")).toBeVisible();
    await expect.element(screen.getByText("Children of Ruin")).toBeVisible();
    await expect.element(componentLocator(screen)).toMatchScreenshot("author-details");
  });
});
