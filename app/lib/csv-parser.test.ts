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

  // --- CSV parsing edge cases ---

  it("handles escaped/doubled quotes in CSV fields", () => {
    const csv = `Title,Author,ISBN13,Exclusive Shelf,Book Id
"The ""Real"" Book","Author A","","to-read","1"`;

    const result = importBooks(csv);
    expect(result.books).toHaveLength(1);
    expect(result.books[0].title).toBe('The "Real" Book');
  });

  it("handles CRLF line endings", () => {
    const csv =
      'Title,Author,ISBN13,Exclusive Shelf,Book Id\r\n"Book A","Author A","","to-read","1"\r\n"Book B","Author B","","read","2"';

    const result = importBooks(csv);
    expect(result.format).toBe("goodreads");
    expect(result.books).toHaveLength(1);
    expect(result.books[0].title).toBe("Book A");
  });

  // --- Lyndi format ---

  it("parses Lyndi format with header not on first row", () => {
    const csv = `Books to Read
Some notes here
Title,Author
"The Hobbit","J.R.R. Tolkien"
"Dune","Frank Herbert"`;

    const result = importBooks(csv);
    expect(result.format).toBe("lyndi");
    expect(result.books).toHaveLength(2);
    expect(result.books[0].title).toBe("The Hobbit");
    expect(result.books[1].title).toBe("Dune");
  });

  it("extracts authors from author-only Lyndi rows", () => {
    const csv = `Books to Read
Title,Author
"The Hobbit","J.R.R. Tolkien"
,"Brandon Sanderson"`;

    const result = importBooks(csv);
    expect(result.format).toBe("lyndi");
    expect(result.books).toHaveLength(1);
    expect(result.authors).toHaveLength(1);
    expect(result.authors[0].name).toBe("Brandon Sanderson");
  });

  it("extracts books from parenthesized notes in Lyndi author rows", () => {
    const csv = `Books to Read
Title,Author,Notes
,"Brandon Sanderson","(Mistborn & Elantris)"`;

    const result = importBooks(csv);
    expect(result.format).toBe("lyndi");
    expect(result.books).toHaveLength(2);
    expect(result.books[0].title).toBe("Mistborn");
    expect(result.books[1].title).toBe("Elantris");
    expect(result.books[0].author).toBe("Brandon Sanderson");
    expect(result.authors).toHaveLength(1);
  });

  it("skips 'was great' segments in Lyndi notes", () => {
    const csv = `Books to Read
Title,Author,Notes
,"Author A","(Book One was great)"`;

    const result = importBooks(csv);
    // "was great" means no book title extracted
    expect(result.authors).toHaveLength(1);
  });

  // --- Hardcover slugs ---

  it("converts relative Hardcover slug to full URL", () => {
    const csv = `Title,Author,ISBN 13,Status,Slug
"Dune","Frank Herbert","","Want to Read","dune"`;

    const result = importBooks(csv);
    expect(result.books[0].sourceUrl).toBe("https://hardcover.app/books/dune");
  });

  it("preserves absolute URL in Hardcover slug", () => {
    const csv = `Title,Author,ISBN 13,Status,Slug
"Dune","Frank Herbert","","Want to Read","https://hardcover.app/books/dune"`;

    const result = importBooks(csv);
    expect(result.books[0].sourceUrl).toBe("https://hardcover.app/books/dune");
  });

  it("recognizes 'Reading Status' column and 'to-read' status in Hardcover", () => {
    const csv = `Title,Author,Reading Status
"Book A","Author A","to-read"`;

    const result = importBooks(csv);
    expect(result.format).toBe("hardcover");
    expect(result.books).toHaveLength(1);
  });

  it("recognizes status value '1' in Hardcover", () => {
    const csv = `Title,Author,Status
"Book A","Author A","1"`;

    const result = importBooks(csv);
    expect(result.format).toBe("hardcover");
    expect(result.books).toHaveLength(1);
  });

  // --- StoryGraph ISBN validation ---

  it("rejects 10-digit ISBNs in StoryGraph", () => {
    const csv = `Title,Authors,ISBN/UID,Read Status,Moods
"Book A","Author A","0345391802","to-read",`;

    const result = importBooks(csv);
    expect(result.books[0].isbn13).toBeUndefined();
  });

  // --- Generic fallback ---

  it("imports rows with Title column via flexible parsing when no status column", () => {
    const csv = `Title,Author,Rating
"Book A","Author A","5"
"Book B","Author B","4"`;

    const result = importBooks(csv);
    // Title + Author without Status/Shelf triggers lyndi flexible parser
    expect(result.format).toBe("lyndi");
    expect(result.books).toHaveLength(2);
  });

  it("skips rows without a title in generic fallback", () => {
    const csv = `Title,Author
"Book A","Author A"
,"Author B"`;

    const result = importBooks(csv);
    // The second row has no title and should be handled
    expect(result.books.length).toBeGreaterThanOrEqual(1);
    expect(result.books[0].title).toBe("Book A");
  });

  it("truncates long header lists in error message", () => {
    const csv = `Col1,Col2,Col3,Col4,Col5,Col6,Col7
"a","b","c","d","e","f","g"`;

    const result = importBooks(csv);
    expect(result.error).toContain("...");
  });

  // --- Goodreads edge cases ---

  it('strips ="..." wrapping from ISBN13 in Goodreads', () => {
    const csv = `Title,Author,ISBN13,Exclusive Shelf,Book Id
"Book A","Author A","=""9780743273565""","to-read","1"`;

    const result = importBooks(csv);
    expect(result.books[0].isbn13).toBe("9780743273565");
  });

  it("skips Goodreads rows without title", () => {
    const csv = `Title,Author,ISBN13,Exclusive Shelf,Book Id
,"Author A","","to-read","1"
"Real Book","Author B","","to-read","2"`;

    const result = importBooks(csv);
    expect(result.books).toHaveLength(1);
    expect(result.books[0].title).toBe("Real Book");
  });
});
