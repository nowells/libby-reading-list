import { describe, it, expect, vi } from "vitest";
import { render } from "vitest-browser-react";
import { BookEditor } from "./book-editor";
import type { Book } from "~/lib/storage";

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: "b1",
    title: "Children of Time",
    author: "Adrian Tchaikovsky",
    source: "goodreads",
    ...overrides,
  };
}

describe("BookEditor", () => {
  it("renders book title and author", async () => {
    const screen = await render(
      <BookEditor book={makeBook()} onSave={vi.fn()} onClose={vi.fn()} />,
    );
    await expect.element(screen.getByText("Children of Time")).toBeVisible();
    await expect.element(screen.getByText("Adrian Tchaikovsky")).toBeVisible();
  });

  it("renders all four status buttons", async () => {
    const screen = await render(
      <BookEditor book={makeBook()} onSave={vi.fn()} onClose={vi.fn()} />,
    );
    // The editor has status, rating, notes, dates, cancel, save, close = many buttons.
    // Verify all four status labels appear somewhere in the dialog.
    const dialog = screen.getByRole("dialog");
    await expect.element(dialog).toBeVisible();
    expect(screen.container.textContent).toContain("Want to read");
    expect(screen.container.textContent).toContain("Reading");
    expect(screen.container.textContent).toContain("Finished");
    expect(screen.container.textContent).toContain("Abandoned");
  });

  it("calls onClose when Cancel is clicked", async () => {
    const onClose = vi.fn();
    const screen = await render(
      <BookEditor book={makeBook()} onSave={vi.fn()} onClose={onClose} />,
    );
    await screen.getByText("Cancel").click();
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when close button is clicked", async () => {
    const onClose = vi.fn();
    const screen = await render(
      <BookEditor book={makeBook()} onSave={vi.fn()} onClose={onClose} />,
    );
    await screen.getByRole("button", { name: "Close" }).click();
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onSave with patch when Save is clicked", async () => {
    const onSave = vi.fn();
    const screen = await render(<BookEditor book={makeBook()} onSave={onSave} onClose={vi.fn()} />);
    await screen.getByText("Save").click();
    expect(onSave).toHaveBeenCalledTimes(1);
    const patch = onSave.mock.calls[0][0];
    expect(patch.status).toBe("wantToRead");
  });

  it("changes status when a status button is clicked", async () => {
    const onSave = vi.fn();
    const screen = await render(<BookEditor book={makeBook()} onSave={onSave} onClose={vi.fn()} />);
    await screen.getByRole("button", { name: "Finished", exact: true }).click();
    await screen.getByText("Save").click();
    const patch = onSave.mock.calls[0][0];
    expect(patch.status).toBe("finished");
    // Auto-stamps finishedAt
    expect(patch.finishedAt).toBeDefined();
  });

  it("preserves existing note in patch", async () => {
    const onSave = vi.fn();
    const screen = await render(
      <BookEditor book={makeBook({ note: "Great book" })} onSave={onSave} onClose={vi.fn()} />,
    );
    await screen.getByText("Save").click();
    expect(onSave.mock.calls[0][0].note).toBe("Great book");
  });

  it("renders cover image when imageUrl is set", async () => {
    const screen = await render(
      <BookEditor
        book={makeBook({ imageUrl: "https://example.com/cover.jpg" })}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const img = screen.container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("https://example.com/cover.jpg");
  });

  it("updates note via textarea", async () => {
    const onSave = vi.fn();
    const screen = await render(<BookEditor book={makeBook()} onSave={onSave} onClose={vi.fn()} />);
    await screen.getByRole("textbox", { name: "Notes" }).fill("My new note");
    await screen.getByText("Save").click();
    expect(onSave.mock.calls[0][0].note).toBe("My new note");
  });

  it("auto-stamps startedAt when switching to Reading", async () => {
    const onSave = vi.fn();
    const screen = await render(<BookEditor book={makeBook()} onSave={onSave} onClose={vi.fn()} />);
    await screen.getByRole("button", { name: "Reading", exact: true }).click();
    await screen.getByText("Save").click();
    const patch = onSave.mock.calls[0][0];
    expect(patch.status).toBe("reading");
    // startedAt should be auto-stamped as an ISO string
    expect(patch.startedAt).toBeDefined();
    expect(patch.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("calls onClose when backdrop is clicked", async () => {
    const onClose = vi.fn();
    const screen = await render(
      <BookEditor book={makeBook()} onSave={vi.fn()} onClose={onClose} />,
    );
    // Click the backdrop (presentation role element)
    const backdrop = screen.container.querySelector('[role="presentation"]') as HTMLElement;
    backdrop.click();
    expect(onClose).toHaveBeenCalled();
  });
});
