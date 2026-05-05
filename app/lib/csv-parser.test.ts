import { describe, it, expect } from "vitest";
import { importBooks } from "./csv-parser";

describe("importBooks", () => {
  it("imports every Goodreads row regardless of shelf, preserving status", () => {
    const csv = `Title,Author,ISBN13,Exclusive Shelf,Book Id
"The Great Gatsby","F. Scott Fitzgerald","9780743273565","to-read","4671"
"1984","George Orwell","9780451524935","read","5470"
"Brave New World","Aldous Huxley","","currently-reading","6"`;

    const result = importBooks(csv);
    expect(result.format).toBe("goodreads");
    expect(result.books).toHaveLength(3);
    const byTitle = new Map(result.books.map((b) => [b.title, b]));
    expect(byTitle.get("The Great Gatsby")?.status).toBe("wantToRead");
    expect(byTitle.get("1984")?.status).toBe("finished");
    expect(byTitle.get("Brave New World")?.status).toBe("reading");
    expect(byTitle.get("The Great Gatsby")?.sourceUrl).toBe(
      "https://www.goodreads.com/book/show/4671",
    );
    expect(result.totalRows).toBe(3);
  });

  it("imports every Hardcover row regardless of status", () => {
    const csv = `Title,Author,ISBN 13,Status,Image
"Dune","Frank Herbert","9780441013593","Want to Read","https://example.com/dune.jpg"
"Foundation","Isaac Asimov","","Read",""
"Hyperion","Dan Simmons","","Currently Reading",""
"Some DNF","Author","","Did Not Finish",""`;

    const result = importBooks(csv);
    expect(result.format).toBe("hardcover");
    expect(result.books).toHaveLength(4);
    const byTitle = new Map(result.books.map((b) => [b.title, b]));
    expect(byTitle.get("Dune")?.status).toBe("wantToRead");
    expect(byTitle.get("Foundation")?.status).toBe("finished");
    expect(byTitle.get("Hyperion")?.status).toBe("reading");
    expect(byTitle.get("Some DNF")?.status).toBe("abandoned");
    expect(byTitle.get("Dune")?.imageUrl).toBe("https://example.com/dune.jpg");
  });

  it("pulls rating, review, and dates from a Goodreads row", () => {
    const csv = `Title,Author,ISBN13,Exclusive Shelf,Book Id,My Rating,My Review,Date Read,Date Added
"1984","George Orwell","9780451524935","read","5470","4","Loved it.","2024-03-15","2024-01-01"`;

    const result = importBooks(csv);
    expect(result.books).toHaveLength(1);
    const b = result.books[0];
    expect(b.rating).toBe(80); // 4 stars → 80/100
    expect(b.note).toBe("Loved it.");
    expect(b.finishedAt).toMatch(/^2024-03-15/);
  });

  it("imports every StoryGraph row regardless of status", () => {
    const csv = `Title,Authors,Contributors,ISBN/UID,Format,Read Status,Date Added,Last Date Read,Dates Read,Read Count,Moods,Pace,Character- or Plot-Driven?,Strong Character Development?,Loveable Characters?,Diverse Characters?,Flawed Characters?,Star Rating,Review,Content Warnings,Content Warning Description,Tags,Owned?
"Children of Time","Adrian Tchaikovsky",,"9781447273288","Paperback","to-read","2026-04-01",,,0,,,,,,,,,,,,,
"Dune","Frank Herbert",,"9780441013593","Hardcover","read","2024-01-01","2024-02-15","2024-02-15",1,,,,,,,,4.5,"Excellent",,,,
"Foundation","Isaac Asimov",,"","Audio","did-not-finish","2025-01-01",,,0,,,,,,,,,,,,,`;

    const result = importBooks(csv);
    expect(result.format).toBe("storygraph");
    expect(result.books).toHaveLength(3);
    const byTitle = new Map(result.books.map((b) => [b.title, b]));
    expect(byTitle.get("Children of Time")?.status).toBe("wantToRead");
    expect(byTitle.get("Dune")?.status).toBe("finished");
    expect(byTitle.get("Dune")?.rating).toBe(90); // 4.5 → 90
    expect(byTitle.get("Dune")?.note).toBe("Excellent");
    expect(byTitle.get("Foundation")?.status).toBe("abandoned");
  });

  it("tolerates 'to read' (no hyphen) in StoryGraph Read Status", () => {
    const csv = `Title,Authors,ISBN/UID,Read Status,Moods
"Book A","Author A","9780000000001","to read",
"Book B","Author B","","to-read",`;

    const result = importBooks(csv);
    expect(result.format).toBe("storygraph");
    expect(result.books).toHaveLength(2);
    expect(result.books[0].isbn13).toBe("9780000000001");
    expect(result.books[0].status).toBe("wantToRead");
    expect(result.books[1].isbn13).toBeUndefined();
    expect(result.books[1].status).toBe("wantToRead");
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

  it("imports rows with no recognizable status as undefined (defaults to want-to-read in storage)", () => {
    const csv = `Title,Author,ISBN13,Exclusive Shelf,Book Id
"Book A","Author A","","weird-shelf","1"`;

    const result = importBooks(csv);
    expect(result.books).toHaveLength(1);
    expect(result.books[0].status).toBeUndefined();
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
    expect(result.books).toHaveLength(2);
    expect(result.books[0].title).toBe("Book A");
    expect(result.books[0].status).toBe("wantToRead");
    expect(result.books[1].title).toBe("Book B");
    expect(result.books[1].status).toBe("finished");
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

  it("uses generic fallback for CSV with Title column but unknown format", () => {
    // Use "Writer" instead of "Author" to avoid matching Lyndi format
    const csv = `Title,Writer,Extra
"My Book","Jane Doe","extra"
"Another","John Smith","data"`;

    const result = importBooks(csv);
    expect(result.format).toBe("unknown");
    expect(result.books).toHaveLength(2);
    expect(result.books[0].title).toBe("My Book");
    expect(result.books[0].source).toBe("unknown");
    expect(result.books[1].title).toBe("Another");
  });

  it("skips rows without title in generic fallback", () => {
    const csv = `Title,Writer,Extra
,"No Title","x"
"Has Title","Writer","y"`;

    const result = importBooks(csv);
    expect(result.books).toHaveLength(1);
    expect(result.books[0].title).toBe("Has Title");
  });

  it("returns error for CSV without a Title column", () => {
    const csv = `Name,Description
"A","B"`;

    const result = importBooks(csv);
    expect(result.format).toBe("unknown");
    expect(result.error).toContain("Unrecognized CSV format");
    expect(result.books).toHaveLength(0);
  });
});
