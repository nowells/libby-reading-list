import { describe, it, expect } from "vitest";
import { NSID, STATUS, statusTokenName } from "./lexicon";

describe("lexicon", () => {
  it("exposes the canonical org.shelfcheck.* NSIDs", () => {
    expect(NSID.shelfEntry).toBe("org.shelfcheck.shelf.entry");
    expect(NSID.authorFollow).toBe("org.shelfcheck.author.follow");
    expect(NSID.bookDismissed).toBe("org.shelfcheck.book.dismissed");
  });

  it("status tokens reference the defs lexicon", () => {
    for (const value of Object.values(STATUS)) {
      expect(value.startsWith("org.shelfcheck.defs#")).toBe(true);
    }
  });

  describe("statusTokenName", () => {
    it("strips the lexicon prefix", () => {
      expect(statusTokenName("org.shelfcheck.defs#wantToRead")).toBe("wantToRead");
    });
    it("passes through bare tokens", () => {
      expect(statusTokenName("finished")).toBe("finished");
    });
    it("returns undefined for missing input", () => {
      expect(statusTokenName(undefined)).toBeUndefined();
    });
  });
});
