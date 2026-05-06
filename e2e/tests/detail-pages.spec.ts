import { expect, test } from "../fixtures/coverage";
import { installMocks } from "../mocks/install";
import { AuthorDetailPage, BookDetailPage, BooksPage, SetupPage } from "../pages";

/**
 * End-to-end coverage for the new /book/:workId and /author/:authorKey
 * routes. We seed a localStorage-only setup (CSV import + library) and
 * then drive every behaviour the detail pages expose: cross-linking,
 * follow/unfollow, want-to-read, mark-as-read, and series + works
 * navigation. localStorage assertions confirm that each surface
 * action persists.
 */

const goodreadsCsv = [
  '"Book Id","Title","Author","Author l-f","ISBN","ISBN13","My Rating","Average Rating","Publisher","Binding","Number of Pages","Year Published","Original Publication Year","Date Read","Date Added","Bookshelves","Bookshelves with positions","Exclusive Shelf","My Review","Spoiler","Private Notes","Read Count","Recommended For","Recommended By","Owned Copies","Original Purchase Date","Original Purchase Location","Condition","Condition Description","BCID"',
  '"1","Children of Time","Adrian Tchaikovsky","Tchaikovsky, Adrian","","=""9780316452502""","0","4.30","Pan Macmillan","Hardcover","600","2015","2015","","2024-01-15","to-read","to-read (#1)","to-read","","","","0","","","0","","","","",""',
].join("\n");

async function seedSetup(page: import("@playwright/test").Page) {
  const setup = new SetupPage(page);
  await setup.goto();
  await setup.uploadCsv("goodreads-export.csv", goodreadsCsv);
  await expect(setup.importBanner()).toContainText("Imported 1 books from Goodreads");
  await setup.searchAndAddLibrary("Los Angeles", /Los Angeles Public Library/);
  await expect(setup.addedLibraryRow("Los Angeles Public Library")).toBeVisible();
}

test.describe("book detail page", () => {
  test("renders OL data, links to author, and persists actions", async ({ page }) => {
    await installMocks(page);
    await seedSetup(page);

    const booksPage = new BooksPage(page);
    const detail = new BookDetailPage(page);

    // The book card cover + title in /books are <Link to="/book/:workId"> —
    // navigating that link is the canonical entry point to the detail page.
    await booksPage.goto();
    await booksPage.waitForReady();
    await page
      .getByRole("link", { name: /Children of Time/ })
      .first()
      .click();
    await detail.waitForReady("Children of Time");

    // Description, rating, and the "First published 2015" metadata pulled
    // from Open Library all surface on the page.
    await expect(detail.description()).toContainText("Spider-POV science fiction");
    await expect(page.getByText(/First published 2015/)).toBeVisible();
    await expect(page.getByText(/4\.30/).first()).toBeVisible();

    // Subject chips are visible (Children of Time has Science Fiction,
    // Space Opera, and Evolution in the catalog fixture).
    await expect(detail.subjectChip("Science Fiction")).toBeVisible();
    await expect(detail.subjectChip("Space Opera")).toBeVisible();

    // Library availability section comes from the Libby route mock.
    // The unified availability table renders Holds as a column header with
    // bare numbers underneath, so assert on the column header instead of
    // the older "X holds" sentence.
    await expect(detail.availabilityHeading()).toBeVisible();
    await expect(page.getByText("Holds", { exact: true }).first()).toBeVisible();

    // Series roll-up: book is part of the "Children of Time" series, and
    // Children of Ruin is the second entry.
    await expect(detail.seriesHeading()).toBeVisible();
    await expect(detail.seriesSibling("Children of Ruin")).toBeVisible();

    // The book is from the imported CSV so the want-to-read action is
    // already done — the page surfaces "Remove from list" instead.
    await expect(detail.removeFromListButton()).toBeVisible();

    // Mark as read → toggles to "Read ✓"; the local read entry persists.
    await detail.markReadButton().click();
    await expect(page.getByRole("button", { name: "Read ✓" })).toBeVisible();
    const stored = await page.evaluate(() => {
      const books = JSON.parse(localStorage.getItem("shelfcheck:books") ?? "[]") as {
        title: string;
        status?: string;
      }[];
      return books.find((b) => b.title === "Children of Time")?.status;
    });
    expect(stored).toBe("finished");

    // Follow author from the detail page → persists to localStorage and
    // the action button disappears.
    await detail.followAuthorButton().click();
    await expect(detail.followAuthorButton()).toHaveCount(0);
    const followedAuthors = await page.evaluate(() => {
      const raw = localStorage.getItem("shelfcheck:authors");
      return raw ? (JSON.parse(raw) as { name: string }[]) : [];
    });
    expect(followedAuthors.map((a) => a.name)).toContain("Adrian Tchaikovsky");

    // Series link navigates to a sibling work — that page renders too.
    await detail.seriesSibling("Children of Ruin").click();
    await detail.waitForReady("Children of Ruin");
    await expect(page.url()).toContain("/book/OL27911570W");
  });

  test("invalid workId surfaces a friendly error", async ({ page }) => {
    await installMocks(page);
    await seedSetup(page);

    const detail = new BookDetailPage(page);
    await detail.goto("not-a-work-id");
    await expect(page.getByRole("heading", { name: "Invalid book identifier" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Back to your books/ })).toBeVisible();
  });
});

test.describe("author detail page", () => {
  test("shows bio, links every work, and persists follow toggle", async ({ page }) => {
    await installMocks(page);
    await seedSetup(page);

    const detail = new AuthorDetailPage(page);
    await detail.goto("OL7313085A");

    // Bio + life-dates from the Open Library mock.
    await detail.waitForReady("Adrian Tchaikovsky");
    await expect(detail.bioSection()).toContainText("British science fiction");
    await expect(page.getByText(/14 June 1972/)).toBeVisible();
    await expect(page.getByText(/Adrian Czajkowski/)).toBeVisible();

    // Works tile grid — each link points at /book/:workId.
    await expect(detail.worksHeading()).toBeVisible();
    await expect(detail.workTile("Children of Time")).toBeVisible();
    await expect(detail.workTile("Children of Ruin")).toBeVisible();

    // Follow → persists to local storage and toggles the button text.
    await detail.followButton().click();
    await expect(detail.followingButton()).toBeVisible();
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem("shelfcheck:authors");
      return raw ? (JSON.parse(raw) as { olKey?: string; name: string }[]) : [];
    });
    expect(stored.some((a) => a.olKey === "OL7313085A")).toBe(true);

    // Unfollow → store cleared, button reverts.
    await detail.followingButton().click();
    await expect(detail.followButton()).toBeVisible();
    const afterUnfollow = await page.evaluate(() => {
      const raw = localStorage.getItem("shelfcheck:authors");
      return raw ? (JSON.parse(raw) as { olKey?: string }[]) : [];
    });
    expect(afterUnfollow.some((a) => a.olKey === "OL7313085A")).toBe(false);

    // Click into a work → routes to the book detail page.
    await detail.workTile("Children of Time").click();
    await expect(page.getByRole("heading", { name: "Children of Time", level: 1 })).toBeVisible();
    expect(page.url()).toContain("/book/OL17823492W");
  });

  test("invalid authorKey surfaces a friendly error", async ({ page }) => {
    await installMocks(page);
    await seedSetup(page);

    const detail = new AuthorDetailPage(page);
    await detail.goto("not-a-real-key");
    await expect(page.getByRole("heading", { name: "Invalid author identifier" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Back to authors/ })).toBeVisible();
  });
});
