import { describe, it, expect } from "vitest";
import { bookhiveRecordsToBooks, type BookhiveListEntry } from "./bookhive-mapper";

function entry(value: BookhiveListEntry["value"], rkey = "abc123"): BookhiveListEntry {
  return {
    uri: `at://did:plc:example/buzz.bookhive.book/${rkey}`,
    value,
  };
}

describe("bookhiveRecordsToBooks", () => {
  it("imports all recognised statuses", () => {
    const books = bookhiveRecordsToBooks([
      entry(
        {
          title: "The Great Gatsby",
          authors: "F. Scott Fitzgerald",
          status: "wantToRead",
        },
        "rk1",
      ),
      entry(
        {
          title: "1984",
          authors: "George Orwell",
          status: "finished",
        },
        "rk2",
      ),
      entry(
        {
          title: "Abandoned Book",
          authors: "Nobody",
          status: "abandoned",
        },
        "rk3",
      ),
      entry(
        {
          title: "Current Book",
          authors: "Someone",
          status: "reading",
        },
        "rk4",
      ),
    ]);

    expect(books).toHaveLength(4);
    expect(books[0]).toMatchObject({
      title: "The Great Gatsby",
      id: "bh-rk1",
      source: "bookhive",
      status: "wantToRead",
    });
    expect(books[1]).toMatchObject({ title: "1984", status: "finished" });
    expect(books[2]).toMatchObject({ title: "Abandoned Book", status: "abandoned" });
    expect(books[3]).toMatchObject({ title: "Current Book", status: "reading" });
  });

  it("joins tab-separated authors with commas", () => {
    const books = bookhiveRecordsToBooks([
      entry({
        title: "Good Omens",
        authors: "Neil Gaiman\tTerry Pratchett",
        status: "wantToRead",
      }),
    ]);

    expect(books[0].author).toBe("Neil Gaiman, Terry Pratchett");
  });

  it("extracts a 13-digit ISBN from identifiers (array form)", () => {
    const books = bookhiveRecordsToBooks([
      entry({
        title: "Dune",
        authors: "Frank Herbert",
        status: "wantToRead",
        identifiers: { isbn13: ["9780441013593"] },
      }),
    ]);

    expect(books[0].isbn13).toBe("9780441013593");
  });

  it("extracts a 13-digit ISBN from identifiers (string form)", () => {
    const books = bookhiveRecordsToBooks([
      entry({
        title: "Dune",
        authors: "Frank Herbert",
        status: "wantToRead",
        identifiers: {
          isbn13: "9780441013593",
        } as unknown as BookhiveListEntry["value"]["identifiers"],
      }),
    ]);

    expect(books[0].isbn13).toBe("9780441013593");
  });

  it("accepts the lexicon-ref form of status (buzz.bookhive.defs#wantToRead)", () => {
    const books = bookhiveRecordsToBooks([
      entry({
        title: "Children of Time",
        authors: "Adrian Tchaikovsky",
        status: "buzz.bookhive.defs#wantToRead",
        identifiers: {
          isbn13: "9781447273288",
        } as unknown as BookhiveListEntry["value"]["identifiers"],
      }),
    ]);

    expect(books).toHaveLength(1);
    expect(books[0].title).toBe("Children of Time");
    expect(books[0].isbn13).toBe("9781447273288");
  });

  it("sets sourceUrl from hiveId when present", () => {
    const books = bookhiveRecordsToBooks([
      entry({
        title: "Children of Time",
        authors: "Adrian Tchaikovsky",
        status: "buzz.bookhive.defs#wantToRead",
        hiveId: "bk_MFWLt6dnDDycSWZLrSh9",
      }),
    ]);

    expect(books[0].sourceUrl).toBe("https://bookhive.buzz/books/bk_MFWLt6dnDDycSWZLrSh9");
  });

  it("omits sourceUrl when hiveId is missing", () => {
    const books = bookhiveRecordsToBooks([
      entry({
        title: "X",
        authors: "Y",
        status: "wantToRead",
      }),
    ]);

    expect(books[0].sourceUrl).toBeUndefined();
  });

  it("maps ref-form statuses correctly", () => {
    const books = bookhiveRecordsToBooks([
      entry({
        title: "Done",
        authors: "x",
        status: "buzz.bookhive.defs#finished",
      }),
    ]);

    expect(books).toHaveLength(1);
    expect(books[0].status).toBe("finished");
  });

  it("falls back to the generic isbn field when isbn13 is missing", () => {
    const books = bookhiveRecordsToBooks([
      entry({
        title: "Some Book",
        authors: "Author",
        status: "wantToRead",
        identifiers: { isbn: ["978-0-7432-7356-5"] },
      }),
    ]);

    expect(books[0].isbn13).toBe("9780743273565");
  });

  it("skips records without a title", () => {
    const books = bookhiveRecordsToBooks([
      entry({
        title: "",
        authors: "x",
        status: "wantToRead",
      }),
    ]);

    expect(books).toHaveLength(0);
  });

  it("ignores records with no status", () => {
    const books = bookhiveRecordsToBooks([
      entry({
        title: "Untagged",
        authors: "x",
      }),
    ]);

    expect(books).toHaveLength(0);
  });
});
