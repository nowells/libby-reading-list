import { expect, type Locator, type Page } from "@playwright/test";

export class ShelfPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto() {
    await this.page.goto("/shelf");
  }

  heading(): Locator {
    return this.page.getByRole("heading", { name: "Your shelf" });
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

  /** Click the Edit button on the supplied entry. */
  async openEditor(title: string) {
    const row = this.entryRow(title);
    await row.getByRole("button", { name: "Edit" }).click();
  }

  /** Click the Remove button (and accept the confirm dialog). */
  async removeEntry(title: string) {
    this.page.once("dialog", (dialog) => dialog.accept());
    await this.entryRow(title).getByRole("button", { name: "Remove" }).click();
  }

  /** The 4 inline status quick-set buttons in the entry's StatusDropdown. */
  async setQuickStatus(title: string, label: string) {
    const row = this.entryRow(title);
    // The status dropdown is a button rendered by the StatusDropdown
    // component — opens a small popover when clicked.
    await row
      .getByRole("button", { name: /Want to read|Reading|Finished|Abandoned/ })
      .first()
      .click();
    await this.page.getByRole("button", { name: label, exact: true }).click();
  }

  async waitForReady() {
    await expect(this.heading()).toBeVisible();
  }
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
