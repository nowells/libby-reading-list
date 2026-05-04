import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Drives the /setup route. Page objects expose locators and actions but
 * never assertions — tests assert directly on the locators they pull
 * off the page object so the test reads as a sequence of expectations.
 */
export class SetupPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto() {
    await this.page.goto("/setup");
  }

  // --- Headers / status ---

  heading(): Locator {
    return this.page.getByRole("heading", { name: "ShelfCheck Setup" });
  }

  importHeading(): Locator {
    return this.page.getByRole("heading", { name: "Add Books" });
  }

  librarySectionHeading(): Locator {
    return this.page.getByRole("heading", { name: /Libby (Library|Libraries)/ });
  }

  /** Banner shown after a successful import, e.g. "Imported 3 books from Goodreads...". */
  importBanner(): Locator {
    return this.page.locator(".bg-green-50, .bg-green-900\\/30").first();
  }

  errorBanner(): Locator {
    return this.page.locator(".bg-red-50, .bg-red-900\\/30").first();
  }

  /** Reveal the (collapsed) Bluesky panel after sign-in. */
  async expandBlueskyPanel() {
    const button = this.page.getByRole("button", { name: "Manage" });
    if (await button.isVisible().catch(() => false)) {
      await button.click();
    }
  }

  /** Reveal the (collapsed) Step 2 panel after books are loaded. */
  async expandImportPanel() {
    const button = this.page.getByRole("button", { name: "Change" });
    if (await button.isVisible().catch(() => false)) {
      await button.click();
    }
  }

  // --- Bluesky sign-in ---

  blueskyHandleInput(): Locator {
    return this.page.getByPlaceholder("your-handle.bsky.social");
  }

  blueskySignInButton(): Locator {
    return this.page.getByRole("button", { name: "Sign in", exact: true });
  }

  /** Pill shown when a Bluesky session is active. */
  blueskySignedInRow(): Locator {
    return this.page.getByText(/Signed in as @/);
  }

  blueskySignOutLink(): Locator {
    return this.page.getByRole("button", { name: "Sign out" });
  }

  blueskyResyncButton(): Locator {
    return this.page.getByRole("button", { name: /Resync|Syncing/ });
  }

  async signInWithBluesky(handle: string) {
    const input = this.blueskyHandleInput();
    await input.fill(handle);
    await this.blueskySignInButton().click();
    // The test OAuth hook reloads the page; wait for /setup to load again.
    await this.page.waitForLoadState("domcontentloaded");
  }

  async signOutOfBluesky() {
    await this.waitForReady();
    await this.expandBlueskyPanel();
    // The Bluesky pane is rendered async (initSession resolves after a
    // brief "Checking Bluesky session..." state). Wait for the Sign out
    // affordance instead of relying on the default action timeout.
    const signOut = this.blueskySignOutLink();
    await signOut.waitFor({ state: "visible", timeout: 10_000 });
    await signOut.click();
  }

  // --- CSV upload ---

  csvFileInput(): Locator {
    return this.page.locator('input[type="file"]');
  }

  /**
   * Upload a CSV body. Playwright treats `setInputFiles` with a
   * `{ name, mimeType, buffer }` object as an in-memory file so we
   * don't have to touch the filesystem.
   */
  async uploadCsv(filename: string, body: string) {
    await this.expandImportPanel();
    await this.csvFileInput().setInputFiles({
      name: filename,
      mimeType: "text/csv",
      buffer: Buffer.from(body, "utf8"),
    });
  }

  // --- Library search ---

  libraryQueryInput(): Locator {
    return this.page.getByPlaceholder("Library name or zip code...");
  }

  librarySearchButton(): Locator {
    return this.page
      .getByRole("button", { name: /Search(ing\.\.\.)?/ })
      .filter({ hasText: /^Search/ });
  }

  /** Buttons for each search result, scoped to the library section. */
  librarySearchResult(name: string | RegExp): Locator {
    return this.page.getByRole("button", { name });
  }

  addedLibraryRow(name: string): Locator {
    // The added-library row sits in a green container. Filter by the
    // library's name to disambiguate from search results.
    return this.page
      .locator(".border-green-200, .border-green-800")
      .filter({ hasText: name })
      .first();
  }

  async searchAndAddLibrary(query: string, libraryName: string | RegExp) {
    await this.libraryQueryInput().fill(query);
    await this.librarySearchButton().click();
    await this.librarySearchResult(libraryName).click();
  }

  /** Navigate to /books once both setup steps are done. */
  viewBooksLink(): Locator {
    return this.page.getByRole("link", { name: "View Available Books" });
  }

  async waitForReady() {
    await expect(this.heading()).toBeVisible();
  }
}
