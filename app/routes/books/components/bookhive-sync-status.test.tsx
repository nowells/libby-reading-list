import { describe, it, expect, vi } from "vitest";
import { render } from "vitest-browser-react";
import { BookhiveSyncStatus } from "./bookhive-sync-status";

// Mock atproto module - initSession returns null by default (no session)
vi.mock("~/lib/atproto", () => ({
  initSession: vi.fn().mockResolvedValue(null),
  refreshPdsSync: vi.fn().mockResolvedValue(undefined),
  getLastPdsSync: vi.fn().mockReturnValue(null),
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

    await expect.element(screen.getByText("Synced via ATproto")).toBeVisible();
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
    await expect.element(screen.getByText("Synced via ATproto")).toBeVisible();

    const button = screen.getByRole("button");
    await expect.element(button).toHaveAttribute("title", "Signed in as @alice.bsky.social");
  });

  it("triggers sync on click", async () => {
    const { initSession, refreshPdsSync } = await import("~/lib/atproto");
    const mockSession = { did: "did:plc:abc123" };
    vi.mocked(initSession).mockResolvedValue({
      session: mockSession as any,
      info: { did: "did:plc:abc123", handle: "alice.bsky.social" },
      fresh: false,
    });
    vi.mocked(refreshPdsSync).mockResolvedValue(undefined);

    const onBooksChanged = vi.fn();
    const screen = await render(<BookhiveSyncStatus onBooksChanged={onBooksChanged} />);

    await expect.element(screen.getByRole("button")).toBeVisible();
    await screen.getByRole("button").click();

    await vi.waitFor(() => {
      expect(refreshPdsSync).toHaveBeenCalledWith("did:plc:abc123");
    });
  });

  it("calls onBooksChanged when sync completes", async () => {
    const { initSession, refreshPdsSync } = await import("~/lib/atproto");
    const mockSession = { did: "did:plc:abc123" };
    vi.mocked(initSession).mockResolvedValue({
      session: mockSession as any,
      info: { did: "did:plc:abc123", handle: "alice.bsky.social" },
      fresh: false,
    });
    vi.mocked(refreshPdsSync).mockResolvedValue(undefined);

    const onBooksChanged = vi.fn();
    const screen = await render(<BookhiveSyncStatus onBooksChanged={onBooksChanged} />);

    // onBooksChanged is called once after initSession resolves
    await vi.waitFor(() => {
      expect(onBooksChanged).toHaveBeenCalledTimes(1);
    });

    // Click to trigger manual resync
    await screen.getByRole("button").click();

    await vi.waitFor(() => {
      // Called again after manual sync
      expect(onBooksChanged).toHaveBeenCalledTimes(2);
    });
  });
});
