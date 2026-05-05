import { expect, type Locator, type Page } from "@playwright/test";

/**
 * The /shelf URL still resolves (redirects to /books?status=all) but the
 * UI is now the unified bookshelf rooted at /books. This page object
 * preserves the old test ergonomics — entryRow / openEditor / removeEntry
 * — by driving the same DOM contract from the unified card.
 */
export class ShelfPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto() {
    // Land on the all-statuses view so the old "every book on the shelf"
    // semantics carry over.
    await this.page.goto("/books?status=all");
  }

  heading(): Locator {
    return this.page.getByRole("heading", { name: "Your books", exact: true });
  }

  /** A shelf list item matched by title. */
  entryRow(title: string): Locator {
    return this.page.locator("li").filter({ hasText: title }).first();
  }

  /** Filter pill for a status, e.g. "Reading (1)". */
  statusFilter(label: string): Locator {
    return this.page.getByRole("button", {
      name: new RegExp(`^${escapeRegex(label)} \\(\\d+\\)$`),
    });
  }

  searchInput(): Locator {
    return this.page.getByPlaceholder("Search title or author...");
  }

  /** Open the per-card actions menu and click "Edit details". */
  async openEditor(title: string) {
    const row = this.entryRow(title);
    await row.getByRole("button", { name: "More actions" }).click();
    await this.page.getByRole("button", { name: "Edit details" }).click();
  }

  /** Open the per-card actions menu and click "Remove" (accept confirm). */
  async removeEntry(title: string) {
    this.page.once("dialog", (dialog) => dialog.accept());
    const row = this.entryRow(title);
    await row.getByRole("button", { name: "More actions" }).click();
    await this.page.getByRole("button", { name: "Remove" }).click();
  }

  /** Click the status pill on the entry's card and choose a new status. */
  async setQuickStatus(title: string, label: string) {
    const row = this.entryRow(title);
    await row.getByRole("button", { name: "Change status" }).click();
    await this.page.getByRole("button", { name: label, exact: true }).click();
  }

  async waitForReady() {
    await expect(this.heading()).toBeVisible();
  }
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
