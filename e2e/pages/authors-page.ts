import { expect, type Locator, type Page } from "@playwright/test";

export class AuthorsPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto() {
    await this.page.goto("/authors");
  }

  heading(): Locator {
    return this.page.getByRole("heading", { name: "Authors", exact: true });
  }

  addAuthorButton(): Locator {
    return this.page.getByRole("button", { name: /^Add$/ });
  }

  addAuthorDialog(): Locator {
    return this.page.getByRole("dialog", { name: "Add an author" });
  }

  authorRow(name: string): Locator {
    return this.page.locator("article, li, div, section").filter({ hasText: name }).first();
  }

  async addAuthor(query: string, name: string | RegExp) {
    await this.addAuthorButton().click();
    await this.addAuthorDialog().getByPlaceholder("Search for an author...").fill(query);
    await this.addAuthorDialog().getByRole("button", { name }).first().click();
  }

  async waitForReady() {
    await expect(this.heading()).toBeVisible();
  }
}
