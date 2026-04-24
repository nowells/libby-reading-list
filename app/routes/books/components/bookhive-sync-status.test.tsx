import { describe, it, expect, vi } from "vitest";
import { render } from "vitest-browser-react";
import { BookhiveSyncStatus } from "./bookhive-sync-status";

// Mock atproto module - initSession returns null by default (no session)
vi.mock("~/lib/atproto", () => ({
  initSession: vi.fn().mockResolvedValue(null),
  syncBookhive: vi.fn().mockResolvedValue([]),
  isBookhiveSyncStale: vi.fn().mockReturnValue(false),
}));

describe("BookhiveSyncStatus", () => {
  it("renders nothing when no session is active", async () => {
    const screen = await render(<BookhiveSyncStatus onBooksChanged={vi.fn()} />);
    // Component returns null when session is null
    expect(screen.container.innerHTML).toBe("");
  });

  it("renders sync button when session is active", async () => {
    const { initSession } = await import("~/lib/atproto");
    const mockSession = { did: "did:plc:abc123" };
    vi.mocked(initSession).mockResolvedValue({
      session: mockSession as any,
      info: { did: "did:plc:abc123", handle: "alice.bsky.social" },
      fresh: false,
    });

    const screen = await render(<BookhiveSyncStatus onBooksChanged={vi.fn()} />);

    await expect.element(screen.getByText("Synced from ATmosphere")).toBeVisible();
  });

  it("shows handle in title attribute", async () => {
    const { initSession } = await import("~/lib/atproto");
    const mockSession = { did: "did:plc:abc123" };
    vi.mocked(initSession).mockResolvedValue({
      session: mockSession as any,
      info: { did: "did:plc:abc123", handle: "alice.bsky.social" },
      fresh: false,
    });

    const screen = await render(<BookhiveSyncStatus onBooksChanged={vi.fn()} />);
    await expect.element(screen.getByText("Synced from ATmosphere")).toBeVisible();

    const button = screen.getByRole("button");
    await expect.element(button).toHaveAttribute("title", "Signed in as @alice.bsky.social");
  });

  it("triggers sync on click", async () => {
    const { initSession, syncBookhive } = await import("~/lib/atproto");
    const mockSession = { did: "did:plc:abc123" };
    vi.mocked(initSession).mockResolvedValue({
      session: mockSession as any,
      info: { did: "did:plc:abc123", handle: "alice.bsky.social" },
      fresh: false,
    });
    vi.mocked(syncBookhive).mockResolvedValue([]);

    const onBooksChanged = vi.fn();
    const screen = await render(<BookhiveSyncStatus onBooksChanged={onBooksChanged} />);

    await expect.element(screen.getByRole("button")).toBeVisible();
    await screen.getByRole("button").click();

    expect(syncBookhive).toHaveBeenCalledWith(mockSession);
  });

  it("calls onBooksChanged when sync imports books", async () => {
    const { initSession, syncBookhive } = await import("~/lib/atproto");
    const mockSession = { did: "did:plc:abc123" };
    vi.mocked(initSession).mockResolvedValue({
      session: mockSession as any,
      info: { did: "did:plc:abc123", handle: "alice.bsky.social" },
      fresh: false,
    });
    vi.mocked(syncBookhive).mockResolvedValue([
      { id: "b1", title: "Book", author: "Auth", source: "bookhive" },
    ]);

    const onBooksChanged = vi.fn();
    const screen = await render(<BookhiveSyncStatus onBooksChanged={onBooksChanged} />);

    await expect.element(screen.getByRole("button")).toBeVisible();
    await screen.getByRole("button").click();

    // Wait for async sync to complete
    await vi.waitFor(() => {
      expect(onBooksChanged).toHaveBeenCalled();
    });
  });

  it("auto-syncs when session is stale", async () => {
    const { initSession, syncBookhive, isBookhiveSyncStale } = await import("~/lib/atproto");
    const mockSession = { did: "did:plc:abc123" };
    vi.mocked(initSession).mockResolvedValue({
      session: mockSession as any,
      info: { did: "did:plc:abc123", handle: "alice.bsky.social" },
      fresh: false,
    });
    vi.mocked(isBookhiveSyncStale).mockReturnValue(true);
    vi.mocked(syncBookhive).mockResolvedValue([]);

    await render(<BookhiveSyncStatus onBooksChanged={vi.fn()} />);

    await vi.waitFor(() => {
      expect(syncBookhive).toHaveBeenCalled();
    });
  });
});
