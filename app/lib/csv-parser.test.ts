import { describe, it, expect } from "vitest";
import { importBooks } from "./csv-parser";

describe("importBooks", () => {
  it("parses Goodreads CSV with want-to-read books", () => {
    const csv = `Title,Author,ISBN13,Exclusive Shelf,Book Id
"The Great Gatsby","F. Scott Fitzgerald","9780743273565","to-read","4671"
"1984","George Orwell","9780451524935","read","5470"`;

    const result = importBooks(csv);
    expect(result.format).toBe("goodreads");
    expect(result.books).toHaveLength(1);
    expect(result.books[0].title).toBe("The Great Gatsby");
    expect(result.books[0].author).toBe("F. Scott Fitzgerald");
    expect(result.books[0].isbn13).toBe("9780743273565");
    expect(result.books[0].source).toBe("goodreads");
    expect(result.books[0].sourceUrl).toBe("https://www.goodreads.com/book/show/4671");
    expect(result.totalRows).toBe(2);
  });

  it("parses Hardcover CSV with want-to-read books", () => {
    const csv = `Title,Author,ISBN 13,Status,Image
"Dune","Frank Herbert","9780441013593","Want to Read","https://example.com/dune.jpg"`;

    const result = importBooks(csv);
    expect(result.format).toBe("hardcover");
    expect(result.books).toHaveLength(1);
    expect(result.books[0].title).toBe("Dune");
    expect(result.books[0].source).toBe("hardcover");
    expect(result.books[0].imageUrl).toBe("https://example.com/dune.jpg");
  });

  it("parses StoryGraph CSV with to-read books", () => {
    const csv = `Title,Authors,Contributors,ISBN/UID,Format,Read Status,Date Added,Last Date Read,Dates Read,Read Count,Moods,Pace,Character- or Plot-Driven?,Strong Character Development?,Loveable Characters?,Diverse Characters?,Flawed Characters?,Star Rating,Review,Content Warnings,Content Warning Description,Tags,Owned?
"Children of Time","Adrian Tchaikovsky",,"9781447273288","Paperback","to-read","2026-04-01",,,0,,,,,,,,,,,,,
"Dune","Frank Herbert",,"9780441013593","Hardcover","read","2024-01-01","2024-02-15","2024-02-15",1,,,,,,,,,,,,,`;

    const result = importBooks(csv);
    expect(result.format).toBe("storygraph");
    expect(result.books).toHaveLength(1);
    expect(result.books[0].title).toBe("Children of Time");
    expect(result.books[0].author).toBe("Adrian Tchaikovsky");
    expect(result.books[0].isbn13).toBe("9781447273288");
    expect(result.books[0].source).toBe("storygraph");
    expect(result.books[0].sourceUrl).toContain("app.thestorygraph.com/browse?search_term=");
    expect(result.books[0].sourceUrl).toContain("Children%20of%20Time");
  });

  it("tolerates 'to read' (no hyphen) in StoryGraph Read Status", () => {
    const csv = `Title,Authors,ISBN/UID,Read Status,Moods
"Book A","Author A","9780000000001","to read",
"Book B","Author B","","to-read",`;

    const result = importBooks(csv);
    expect(result.format).toBe("storygraph");
    expect(result.books).toHaveLength(2);
    expect(result.books[0].isbn13).toBe("9780000000001");
    expect(result.books[1].isbn13).toBeUndefined();
  });

  it("returns error for empty input", () => {
    const result = importBooks("");
    expect(result.error).toBeTruthy();
    expect(result.books).toHaveLength(0);
  });

  it("returns error for unrecognized CSV format", () => {
    const csv = `Name,Value
"foo","bar"`;

    const result = importBooks(csv);
    expect(result.error).toContain("Unrecognized");
    expect(result.books).toHaveLength(0);
  });

  it("filters out non-want-to-read books from Goodreads", () => {
    const csv = `Title,Author,ISBN13,Exclusive Shelf,Book Id
"Book A","Author A","","to-read","1"
"Book B","Author B","","currently-reading","2"
"Book C","Author C","","read","3"`;

    const result = importBooks(csv);
    expect(result.books).toHaveLength(1);
    expect(result.books[0].title).toBe("Book A");
  });
});
