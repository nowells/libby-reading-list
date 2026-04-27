import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Wraps the BookEditor modal that appears on /books and /shelf when a
 * book's "Edit" affordance is clicked. The modal exposes status,
 * rating, note, started/finished dates, and a save/cancel pair.
 */
export class BookEditor {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  dialog(): Locator {
    return this.page.getByRole("dialog", { name: /^Edit / });
  }

  statusButton(label: "Want to read" | "Reading" | "Finished" | "Abandoned"): Locator {
    return this.dialog().getByRole("button", { name: label, exact: true });
  }

  ratingSlider(): Locator {
    return this.dialog().getByRole("slider");
  }

  /** The rating component is 5 half-star pairs; click the 2nd full-star slot for 2 stars. */
  async setRating(stars: 1 | 2 | 3 | 4 | 5) {
    const value = stars * 20;
    const button = this.dialog().locator(`button[aria-label="${value} percent"]`);
    await button.click();
  }

  noteTextarea(): Locator {
    return this.dialog().getByRole("textbox", { name: "Notes" });
  }

  async setNote(note: string) {
    const t = this.noteTextarea();
    await t.fill(note);
  }

  async setStatus(label: "Want to read" | "Reading" | "Finished" | "Abandoned") {
    await this.statusButton(label).click();
  }

  async save() {
    await this.dialog().getByRole("button", { name: "Save", exact: true }).click();
    await expect(this.dialog()).toBeHidden();
  }

  async cancel() {
    await this.dialog().getByRole("button", { name: "Cancel", exact: true }).click();
  }
}
