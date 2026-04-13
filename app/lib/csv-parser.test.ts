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
