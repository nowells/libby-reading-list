import { expect, test } from "../fixtures/coverage";
import { installMocks } from "../mocks/install";
import { AuthorsPage, BookEditor, SetupPage, ShelfPage } from "../pages";

/**
 * End-to-end coverage for the Bluesky / ATproto path. The same test
 * process owns a single MockPds instance across two distinct page
 * loads so we can verify that records written on the first sign-in
 * are pulled back down on the second (different "device").
 */

const ALICE = {
  did: "did:plc:alice-test",
  handle: "alice.test",
};

test.describe("Bluesky-backed user", () => {
  test("syncs books, ratings, and authors to the PDS and re-hydrates after sign-out", async ({
    page,
  }) => {
    // The mock PDS lives in this Node process and persists across the
    // local cache wipe that sign-out triggers. That lets us observe the
    // app's behaviour for a returning user (or "second device") without
    // shuffling Playwright contexts around — the only thing that
    // changes between sessions is the local cache, exactly the same
    // setup as a real PDS-backed user opening ShelfCheck on a new
    // browser.
    const mocks = await installMocks(page, { blueskyAccounts: [ALICE] });
    mocks.pds.upsertProfile(ALICE.did, ALICE.handle);

    const setup = new SetupPage(page);
    const shelf = new ShelfPage(page);
    const authors = new AuthorsPage(page);
    const editor = new BookEditor(page);

    // --- First sign-in: empty PDS, push everything up via bootstrap ---
    await setup.goto();
    await setup.signInWithBluesky(ALICE.handle);
    await expect(setup.blueskySignedInRow()).toContainText(`@${ALICE.handle}`);

    // Library is required for /books; libraries live only in
    // localStorage so we'll have to add it again on the "second device".
    await setup.searchAndAddLibrary("Los Angeles", /Los Angeles Public Library/);
    await expect(setup.addedLibraryRow("Los Angeles Public Library")).toBeVisible();

    // /shelf renders even without books, so use it to add through the
    // shared search picker. CSV import is exercised in the local-only
    // spec; here we want to verify that storage mutations propagate to
    // the PDS via the sync engine.
    await page.goto("/shelf");
    await shelf.waitForReady();

    await page.getByRole("button", { name: /^Add$/ }).click();
    const dialog = page.getByRole("dialog", { name: "Add a book" });
    await dialog.getByPlaceholder(/Search by title or author/).fill("Children of Time");
    await dialog.getByRole("button", { name: /Children of Time/ }).click();
    await expect(shelf.entryRow("Children of Time")).toBeVisible();

    // Edit the book: status + rating + note → mirrored as a PDS update.
    await shelf.openEditor("Children of Time");
    await editor.setStatus("Reading");
    await editor.setRating(5);
    await editor.setNote("My favourite spider book.");
    await editor.save();

    // Add a second book.
    await page.getByRole("button", { name: /^Add$/ }).click();
    await page
      .getByRole("dialog", { name: "Add a book" })
      .getByPlaceholder(/Search by title or author/)
      .fill("Dune");
    await page
      .getByRole("dialog", { name: "Add a book" })
      .getByRole("button", { name: /^Dune/ })
      .click();
    await expect(shelf.entryRow("Dune")).toBeVisible();

    // Follow an author → org.shelfcheck.author.follow record.
    await page.getByRole("link", { name: "Authors" }).click();
    await authors.waitForReady();
    await authors.addAuthor("Adrian Tchaikovsky", /Adrian Tchaikovsky/);

    // PDS state: two shelf entries + one author follow.
    await expect
      .poll(() => mocks.pds.countRecords(ALICE.did, "org.shelfcheck.shelf.entry"), {
        message: "two shelf entries should be synced to the PDS",
      })
      .toBe(2);
    await expect
      .poll(() => mocks.pds.countRecords(ALICE.did, "org.shelfcheck.author.follow"))
      .toBe(1);

    const shelfRecords = mocks.pds.recordsFor(ALICE.did, "org.shelfcheck.shelf.entry");
    const childrenRecord = Object.values(shelfRecords).find(
      (r) => (r as { title?: string }).title === "Children of Time",
    ) as Record<string, unknown> | undefined;
    expect(childrenRecord).toBeTruthy();
    expect(childrenRecord?.status).toBe("org.shelfcheck.defs#reading");
    expect(childrenRecord?.rating).toBe(100);
    expect(childrenRecord?.note).toBe("My favourite spider book.");

    // --- Sign out: local cache wiped, PDS untouched ---
    await setup.goto();
    await setup.signOutOfBluesky();
    await expect(setup.blueskyHandleInput()).toBeVisible();
    // Wipe local data exactly the way a fresh device would have it.
    // sessionStorage holds the test OAuth's "active session" pointer —
    // clearing it lets the next sign-in start clean.
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();
    await setup.waitForReady();

    // --- Second sign-in: empty local cache, populated PDS ---
    await setup.signInWithBluesky(ALICE.handle);
    await setup.waitForReady();
    // The reconcile pulls Alice's two shelf entries into local storage
    // before this expect resolves, which collapses the Bluesky panel.
    // Expand it so the "Signed in as @alice.test" row is visible.
    await setup.expandBlueskyPanel();
    await expect(setup.blueskySignedInRow()).toContainText(`@${ALICE.handle}`);
    // Libraries are not stored in the PDS; re-add so /shelf renders.
    await setup.searchAndAddLibrary("Los Angeles", /Los Angeles Public Library/);

    await shelf.goto();
    await shelf.waitForReady();

    // Both books were pulled back down by the reconcile that runs as
    // part of attachSession.
    await expect(shelf.entryRow("Children of Time")).toBeVisible();
    await expect(shelf.entryRow("Children of Time")).toContainText("My favourite spider book.");
    await expect(shelf.entryRow("Children of Time")).toContainText("Reading");
    await expect(shelf.entryRow("Dune")).toBeVisible();

    // Author follows came along too.
    await page.getByRole("link", { name: "Authors" }).click();
    await expect(page.getByText("Adrian Tchaikovsky").first()).toBeVisible();

    // Local removal on the "second device" propagates as a delete.
    await shelf.goto();
    await shelf.removeEntry("Dune");
    await expect
      .poll(() => mocks.pds.countRecords(ALICE.did, "org.shelfcheck.shelf.entry"))
      .toBe(1);
  });
});
