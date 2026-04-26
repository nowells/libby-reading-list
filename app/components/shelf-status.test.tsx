import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-react";
import { statusLabel, effectiveStatus, StatusPill, SHELF_STATUSES } from "./shelf-status";
import type { Book, ShelfStatus } from "~/lib/storage";
import { componentLocator } from "~/test/screenshot";

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: "b1",
    title: "Test",
    author: "Author",
    source: "unknown",
    ...overrides,
  };
}

describe("shelf-status", () => {
  describe("statusLabel", () => {
    it("returns human-readable labels for all statuses", () => {
      expect(statusLabel("wantToRead")).toBe("Want to read");
      expect(statusLabel("reading")).toBe("Reading");
      expect(statusLabel("finished")).toBe("Finished");
      expect(statusLabel("abandoned")).toBe("Abandoned");
    });
  });

  describe("effectiveStatus", () => {
    it("returns the book's status when set", () => {
      expect(effectiveStatus(makeBook({ status: "reading" }))).toBe("reading");
      expect(effectiveStatus(makeBook({ status: "finished" }))).toBe("finished");
    });

    it("defaults to wantToRead when status is undefined", () => {
      expect(effectiveStatus(makeBook({ status: undefined }))).toBe("wantToRead");
    });
  });

  describe("SHELF_STATUSES", () => {
    it("contains all four statuses", () => {
      expect(SHELF_STATUSES).toEqual(["wantToRead", "reading", "finished", "abandoned"]);
    });
  });

  describe("StatusPill", () => {
    it.each<ShelfStatus>(["wantToRead", "reading", "finished", "abandoned"])(
      "renders label for %s",
      async (status) => {
        const screen = await render(<StatusPill status={status} />);
        await expect.element(screen.getByText(statusLabel(status))).toBeVisible();
      },
    );

    it("all status pills match screenshot", async () => {
      const screen = await render(
        <div className="flex flex-wrap gap-2 p-4 bg-white">
          {SHELF_STATUSES.map((s) => (
            <StatusPill key={s} status={s} />
          ))}
        </div>,
      );
      await expect.element(componentLocator(screen)).toMatchScreenshot("status-pill-variants");
    });
  });
});
