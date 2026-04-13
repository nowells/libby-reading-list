const HARDCOVER_API_URL = "https://api.hardcover.app/v1/graphql";

export interface HardcoverBook {
  id: number;
  title: string;
  subtitle?: string;
  slug: string;
  pages?: number;
  description?: string;
  image?: { url: string };
  contributions: Array<{ author: { name: string } }>;
  editions: Array<{
    isbn_13?: string;
    isbn_10?: string;
  }>;
}

export interface UserBook {
  id: number;
  rating?: number;
  date_added: string;
  book: HardcoverBook;
}

const WANT_TO_READ_QUERY = `
  query WantToRead($offset: Int!, $limit: Int!) {
    me {
      user_books(
        where: { status_id: { _eq: 1 } }
        order_by: { date_added: desc }
        limit: $limit
        offset: $offset
      ) {
        id
        rating
        date_added
        book {
          id
          title
          subtitle
          slug
          pages
          description
          image {
            url
          }
          contributions {
            author {
              name
            }
          }
          editions(limit: 5) {
            isbn_13
            isbn_10
          }
        }
      }
    }
  }
`;

export async function fetchWantToRead(
  apiKey: string,
  offset = 0,
  limit = 50
): Promise<{ books: UserBook[]; hasMore: boolean }> {
  const res = await fetch(HARDCOVER_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: apiKey.startsWith("Bearer ")
        ? apiKey
        : `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query: WANT_TO_READ_QUERY,
      variables: { offset, limit },
    }),
  });

  if (!res.ok) {
    throw new Error(`Hardcover API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  if (data.errors) {
    throw new Error(
      `Hardcover GraphQL error: ${data.errors.map((e: { message: string }) => e.message).join(", ")}`
    );
  }

  const userBooks: UserBook[] = data.data?.me?.[0]?.user_books ?? [];
  return {
    books: userBooks,
    hasMore: userBooks.length === limit,
  };
}

export async function fetchAllWantToRead(
  apiKey: string
): Promise<UserBook[]> {
  const PAGE_SIZE = 50;
  const allBooks: UserBook[] = [];
  let offset = 0;

  while (true) {
    const { books, hasMore } = await fetchWantToRead(apiKey, offset, PAGE_SIZE);
    allBooks.push(...books);
    if (!hasMore) break;
    offset += PAGE_SIZE;
  }

  return allBooks;
}

export async function verifyApiKey(apiKey: string): Promise<boolean> {
  try {
    console.log("[hardcover] verifyApiKey: fetching", HARDCOVER_API_URL);
    const res = await fetch(HARDCOVER_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: apiKey.startsWith("Bearer ")
          ? apiKey
          : `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: `{ me { username } }`,
      }),
    });
    console.log("[hardcover] verifyApiKey: status", res.status, res.statusText);
    if (!res.ok) {
      const body = await res.text();
      console.log("[hardcover] verifyApiKey: error response body:", body);
      return false;
    }
    const data = await res.json();
    const username = data.data?.me?.[0]?.username;
    console.log("[hardcover] verifyApiKey: username =", username, "errors =", data.errors);
    return !!username;
  } catch (err) {
    console.log("[hardcover] verifyApiKey: exception:", err);
    return false;
  }
}
