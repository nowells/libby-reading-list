import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Drives /book/:workId — the rich book details surface that pulls
 * description, ratings, edition roll-ups, and library availability for
 * a single Open Library work.
 */
export class BookDetailPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(workId: string) {
    await this.page.goto(`/book/${workId}`);
  }

  /** The h1 carries the book title once details load. */
  heading(name: string | RegExp): Locator {
    return this.page.getByRole("heading", { name, level: 1 });
  }

  description(): Locator {
    return this.page
      .locator("section, div")
      .filter({ has: this.page.getByRole("heading", { name: "Description" }) })
      .first();
  }

  ratingSummary(): Locator {
    // The rating sits in the metadata row next to "First published / N pages".
    return this.page.locator("span.tabular-nums").first();
  }

  subjectChip(name: string): Locator {
    return this.page.getByText(name, { exact: true });
  }

  /** "Want to read" / "Remove from list" toggle. */
  wantToReadButton(): Locator {
    return this.page.getByRole("button", { name: "Want to read" });
  }

  removeFromListButton(): Locator {
    return this.page.getByRole("button", { name: "Remove from list" });
  }

  markReadButton(): Locator {
    return this.page.getByRole("button", { name: /^Mark as read$|^Read ✓$/ });
  }

  followAuthorButton(): Locator {
    return this.page.getByRole("button", { name: "Follow author" });
  }

  /** Section header for the per-library availability list. */
  availabilityHeading(): Locator {
    return this.page.getByRole("heading", { name: "At your libraries" });
  }

  /** Section header for series roll-up. */
  seriesHeading(): Locator {
    return this.page.getByRole("heading", { name: /^More in/ });
  }

  /** Anchor link to a series sibling (rendered as a `<Link to="/book/...">`). */
  seriesSibling(title: string): Locator {
    return this.page.getByRole("link", { name: new RegExp(title) });
  }

  /** The "by <Author>" link in the hero. Returns a Locator for the link. */
  authorLink(): Locator {
    return this.page.locator("p", { hasText: /^by / }).getByRole("link").first();
  }

  async waitForReady(title: string | RegExp) {
    await expect(this.heading(title)).toBeVisible();
  }
}
