import { expect, type Locator, type Page } from "@playwright/test";

export class BooksPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto() {
    await this.page.goto("/books");
  }

  heading(): Locator {
    return this.page.getByRole("heading", { name: "Your books", exact: true });
  }

  /** A book card matched by title; the card root is a list item article. */
  bookCard(title: string): Locator {
    return this.page.locator("article, li, div").filter({ hasText: title }).first();
  }

  /** All visible book titles (scoped to card headings, not header bar). */
  visibleTitles(): Locator {
    return this.page.locator(".max-w-3xl h3");
  }

  addBookButton(): Locator {
    return this.page.getByRole("button", { name: /^Add$/ });
  }

  addBookDialog(): Locator {
    return this.page.getByRole("dialog", { name: "Add a book" });
  }

  bookSearchInput(): Locator {
    return this.addBookDialog().getByPlaceholder(/Search Libby/);
  }

  async addBook(query: string, title: string | RegExp) {
    await this.addBookButton().click();
    await this.bookSearchInput().fill(query);
    const result = this.addBookDialog().getByRole("button", { name: title });
    await result.click();
  }

  async openAuthors() {
    await this.page.getByRole("link", { name: "Authors" }).click();
  }

  async openSettings() {
    await this.page.getByRole("link", { name: "Settings" }).click();
  }

  /** Status pill that shows "Synced X ago" when an ATproto session is attached. */
  blueskySyncPill(): Locator {
    return this.page.getByRole("button", { name: /Synced (via ATproto|.+ago)|Syncing with PDS/ });
  }

  async waitForReady() {
    await expect(this.heading()).toBeVisible();
  }
}
