import { describe, it, expect, vi } from "vitest";
import { render } from "vitest-browser-react";
import { BookhiveSyncStatus } from "./bookhive-sync-status";

// Mock atproto module - initSession returns null by default (no session)
// and there's no remembered account, so the component renders null.
vi.mock("~/lib/atproto", () => ({
  initSession: vi.fn().mockResolvedValue(null),
  refreshPdsSync: vi.fn().mockResolvedValue(undefined),
  getLastPdsSync: vi.fn().mockReturnValue(null),
  getLastSignedInAccount: vi.fn().mockReturnValue(null),
  onSessionChange: vi.fn().mockReturnValue(() => {}),
  signInWithBluesky: vi.fn().mockResolvedValue(undefined),
}));

describe("BookhiveSyncStatus", () => {
  it("renders nothing when no session is active and no account is remembered", async () => {
    const screen = await render(<BookhiveSyncStatus onBooksChanged={vi.fn()} />);
    // Component returns null when there's no session and nothing to reauth as.
    expect(screen.container.innerHTML).toBe("");
  });

  it("renders Reconnect Bluesky pill when session is gone but account is remembered", async () => {
    const { initSession, getLastSignedInAccount } = await import("~/lib/atproto");
    vi.mocked(initSession).mockResolvedValue(null);
    vi.mocked(getLastSignedInAccount).mockReturnValue({
      did: "did:plc:abc123",
      handle: "alice.bsky.social",
    });

    const screen = await render(<BookhiveSyncStatus onBooksChanged={vi.fn()} />);

    await expect.element(screen.getByText("Reconnect Bluesky")).toBeVisible();
    const button = screen.getByRole("button");
    await expect
      .element(button)
      .toHaveAttribute(
        "title",
        "Bluesky session expired — click to reconnect as @alice.bsky.social",
      );
  });

  it("triggers OAuth sign-in when the Reconnect Bluesky pill is clicked", async () => {
    const { initSession, getLastSignedInAccount, signInWithBluesky } =
      await import("~/lib/atproto");
    vi.mocked(initSession).mockResolvedValue(null);
    vi.mocked(getLastSignedInAccount).mockReturnValue({
      did: "did:plc:abc123",
      handle: "alice.bsky.social",
    });

    const screen = await render(<BookhiveSyncStatus onBooksChanged={vi.fn()} />);

    await expect.element(screen.getByText("Reconnect Bluesky")).toBeVisible();
    await screen.getByRole("button").click();

    await vi.waitFor(() => {
      expect(signInWithBluesky).toHaveBeenCalledWith("alice.bsky.social");
    });
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
