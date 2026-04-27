import { expect, test } from "@playwright/test";
import { installMocks } from "../mocks/install";
import { AuthorsPage, BookEditor, BooksPage, SetupPage, ShelfPage } from "../pages";

/**
 * End-to-end coverage for a user who never signs in with Bluesky and
 * relies solely on localStorage. We exercise every behaviour the local
 * harness supports — CSV import, manual book/author additions, ratings,
 * notes, status changes — and verify the data survives a hard reload
 * (different from a sign-out, which only matters for ATproto users).
 */

const goodreadsCsv = [
  '"Book Id","Title","Author","Author l-f","ISBN","ISBN13","My Rating","Average Rating","Publisher","Binding","Number of Pages","Year Published","Original Publication Year","Date Read","Date Added","Bookshelves","Bookshelves with positions","Exclusive Shelf","My Review","Spoiler","Private Notes","Read Count","Recommended For","Recommended By","Owned Copies","Original Purchase Date","Original Purchase Location","Condition","Condition Description","BCID"',
  '"1","Children of Time","Adrian Tchaikovsky","Tchaikovsky, Adrian","","=""9780316452502""","0","4.30","Pan Macmillan","Hardcover","600","2015","2015","","2024-01-15","to-read","to-read (#1)","to-read","","","","0","","","0","","","","",""',
  '"2","Dune","Frank Herbert","Herbert, Frank","","=""9780441172719""","0","4.25","Ace Books","Paperback","688","1965","1965","","2024-01-16","to-read","to-read (#2)","to-read","","","","0","","","0","","","","",""',
].join("\n");

test.describe("local-only user", () => {
  test("persists across page reloads and exercises the full local flow", async ({ page }) => {
    const { books } = await installMocks(page);

    const setup = new SetupPage(page);
    const booksPage = new BooksPage(page);
    const shelf = new ShelfPage(page);
    const authors = new AuthorsPage(page);
    const editor = new BookEditor(page);

    // --- Step 1: import a Goodreads CSV ---
    await setup.goto();
    await expect(setup.heading()).toBeVisible();
    await setup.uploadCsv("goodreads-export.csv", goodreadsCsv);
    await expect(setup.importBanner()).toContainText("Imported 2 books from Goodreads");

    // --- Step 2: add a Libby library ---
    await setup.searchAndAddLibrary("Los Angeles", /Los Angeles Public Library/);
    await expect(setup.addedLibraryRow("Los Angeles Public Library")).toBeVisible();

    // CTA appears once both steps are complete.
    await expect(setup.viewBooksLink()).toBeVisible();
    await setup.viewBooksLink().click();

    // --- Books page shows both imported titles, no Bluesky pill ---
    await booksPage.waitForReady();
    await expect(page.getByText("Children of Time").first()).toBeVisible();
    await expect(page.getByText("Dune", { exact: true }).first()).toBeVisible();
    await expect(booksPage.blueskySyncPill()).toHaveCount(0);

    // --- Add a third book directly from Libby search ---
    const projectHailMary = books.find((b) => b.title === "Project Hail Mary");
    expect(projectHailMary, "fixture catalog includes Project Hail Mary").toBeTruthy();
    await booksPage.addBook("Project Hail Mary", /Project Hail Mary/);
    await expect(page.getByText("Project Hail Mary").first()).toBeVisible();

    // --- Add an author from the Authors page ---
    await booksPage.openAuthors();
    await authors.waitForReady();
    await authors.addAuthor("Adrian Tchaikovsky", /Adrian Tchaikovsky/);
    await expect(page.getByText("Adrian Tchaikovsky").first()).toBeVisible();

    // --- Open the shelf and edit the first book: status, rating, note ---
    await page.getByRole("link", { name: "Shelf" }).click();
    await shelf.waitForReady();
    await shelf.openEditor("Children of Time");
    await editor.setStatus("Reading");
    await editor.setRating(4);
    await editor.setNote("Spider POV is unexpectedly excellent.");
    await editor.save();

    // --- Verify persistence across a hard reload ---
    await page.reload();
    await shelf.waitForReady();
    const childrenRow = shelf.entryRow("Children of Time");
    await expect(childrenRow).toContainText("Spider POV is unexpectedly excellent.");
    await expect(childrenRow).toContainText("Reading");

    // localStorage still holds the books, the rating, the note, and the library.
    const storedBooks = await page.evaluate(() => {
      const raw = localStorage.getItem("shelfcheck:books");
      return raw
        ? (JSON.parse(raw) as { title: string; rating?: number; note?: string; status?: string }[])
        : [];
    });
    const childrenInStorage = storedBooks.find((b) => b.title === "Children of Time");
    expect(childrenInStorage?.rating).toBe(80);
    expect(childrenInStorage?.note).toBe("Spider POV is unexpectedly excellent.");
    expect(childrenInStorage?.status).toBe("reading");

    const storedLibraries = await page.evaluate(() => {
      const raw = localStorage.getItem("shelfcheck:libraries");
      return raw ? (JSON.parse(raw) as { key: string; name: string }[]) : [];
    });
    expect(storedLibraries.map((l) => l.key)).toContain("lapl");

    const storedAuthors = await page.evaluate(() => {
      const raw = localStorage.getItem("shelfcheck:authors");
      return raw ? (JSON.parse(raw) as { name: string }[]) : [];
    });
    expect(storedAuthors.map((a) => a.name)).toContain("Adrian Tchaikovsky");

    // --- Remove a book and ensure removal also persists ---
    await shelf.goto();
    await shelf.removeEntry("Dune");
    await expect(shelf.entryRow("Dune")).toHaveCount(0);

    await page.reload();
    await shelf.waitForReady();
    await expect(shelf.entryRow("Dune")).toHaveCount(0);
    await expect(shelf.entryRow("Children of Time")).toBeVisible();
    await expect(shelf.entryRow("Project Hail Mary")).toBeVisible();
  });

  test("Reset All clears every local store", async ({ page }) => {
    await installMocks(page);
    const setup = new SetupPage(page);
    const booksPage = new BooksPage(page);

    await setup.goto();
    await setup.uploadCsv("goodreads-export.csv", goodreadsCsv);
    await expect(setup.importBanner()).toContainText("Imported 2 books");
    await setup.searchAndAddLibrary("Los Angeles", /Los Angeles Public Library/);

    await booksPage.goto();
    await booksPage.waitForReady();
    await expect(page.getByText("Children of Time").first()).toBeVisible();

    await booksPage.openSettings();
    await page.getByRole("button", { name: "Reset All" }).click();

    // After reset, the books and libraries are empty so /books bounces to /setup.
    const localStorageEmpty = await page.evaluate(() => {
      return {
        books: localStorage.getItem("shelfcheck:books"),
        libraries: localStorage.getItem("shelfcheck:libraries"),
        authors: localStorage.getItem("shelfcheck:authors"),
      };
    });
    expect(localStorageEmpty.books).toBeNull();
    expect(localStorageEmpty.libraries).toBeNull();
    expect(localStorageEmpty.authors).toBeNull();
  });
});
