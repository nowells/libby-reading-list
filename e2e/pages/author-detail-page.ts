import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Drives /author/:authorKey — bio, dates, links, plus a tile grid of
 * every work Open Library has on file for the author.
 */
export class AuthorDetailPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(authorKey: string) {
    await this.page.goto(`/author/${authorKey}`);
  }

  heading(name: string | RegExp): Locator {
    return this.page.getByRole("heading", { name, level: 1 });
  }

  followButton(): Locator {
    return this.page.getByRole("button", { name: "Follow author" });
  }

  followingButton(): Locator {
    return this.page.getByRole("button", { name: "Following ✓" });
  }

  worksHeading(): Locator {
    return this.page.getByRole("heading", { name: "Works", level: 2 });
  }

  /** A tile linking to /book/:workId for one of the author's works. */
  workTile(title: string): Locator {
    return this.page.getByRole("link", { name: new RegExp(title) });
  }

  bioSection(): Locator {
    return this.page
      .locator("section, div")
      .filter({ has: this.page.getByRole("heading", { name: "About" }) })
      .first();
  }

  async waitForReady(name: string | RegExp) {
    // Mirror BookDetailPage: clientLoader awaits OL author details
    // (15s internal fetch budget) and CI pays for a cold Vite compile
    // of this route's chunk on the first navigation.
    await expect(this.heading(name)).toBeVisible({ timeout: 30_000 });
  }
}
