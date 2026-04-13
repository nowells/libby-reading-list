import { Form, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/setup";
import { getSession, commitSession } from "~/lib/session.server";
import { verifyApiKey } from "~/lib/hardcover.server";
import { searchLibraryByName, getLibraryPreferredKey, type LibbyLibrary } from "~/lib/libby.server";

export async function loader({ request }: Route.LoaderArgs) {
  const session = await getSession(request);
  const url = new URL(request.url);
  const libraryQuery = url.searchParams.get("libraryQuery") ?? "";

  let libraries: LibbyLibrary[] = [];
  if (libraryQuery.length >= 2) {
    try {
      libraries = await searchLibraryByName(libraryQuery);
      console.log("[setup] library search for", JSON.stringify(libraryQuery), "returned", libraries.length, "results");
    } catch (err) {
      console.log("[setup] library search error:", err);
    }
  }

  return {
    hardcoverApiKey: (session.get("hardcoverApiKey") as string) ?? "",
    libraryKey: (session.get("libraryKey") as string) ?? "",
    libraryName: (session.get("libraryName") as string) ?? "",
    libraries,
    libraryQuery,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const session = await getSession(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "saveHardcover") {
    const apiKey = formData.get("apiKey") as string;
    if (!apiKey) {
      return { error: "API key is required" };
    }
    const valid = await verifyApiKey(apiKey);
    if (!valid) {
      return { error: "Invalid API key. Please check and try again." };
    }
    session.set("hardcoverApiKey", apiKey);
    return redirect("/setup", {
      headers: { "Set-Cookie": await commitSession(session) },
    });
  }

  if (intent === "saveLibrary") {
    const fulfillmentId = formData.get("libraryKey") as string;
    const libraryName = formData.get("libraryName") as string;
    if (!fulfillmentId) {
      return { error: "Please select a library" };
    }
    // fulfillmentId is used for Thunder API searches, preferredKey for Libby URLs
    let preferredKey = fulfillmentId;
    try {
      preferredKey = await getLibraryPreferredKey(fulfillmentId);
    } catch {
      // Fall back to fulfillmentId if lookup fails
    }
    session.set("libraryKey", fulfillmentId);
    session.set("libraryPreferredKey", preferredKey);
    session.set("libraryName", libraryName);
    return redirect("/setup", {
      headers: { "Set-Cookie": await commitSession(session) },
    });
  }

  if (intent === "clearHardcover") {
    session.unset("hardcoverApiKey");
    return redirect("/setup", {
      headers: { "Set-Cookie": await commitSession(session) },
    });
  }

  if (intent === "clearLibrary") {
    session.unset("libraryKey");
    session.unset("libraryPreferredKey");
    session.unset("libraryName");
    return redirect("/setup", {
      headers: { "Set-Cookie": await commitSession(session) },
    });
  }

  if (intent === "clearAll") {
    session.unset("hardcoverApiKey");
    session.unset("libraryKey");
    session.unset("libraryPreferredKey");
    session.unset("libraryName");
    return redirect("/setup", {
      headers: { "Set-Cookie": await commitSession(session) },
    });
  }

  return null;
}

export default function Setup({ loaderData, actionData }: Route.ComponentProps) {
  const {
    hardcoverApiKey,
    libraryKey,
    libraryName,
    libraries,
    libraryQuery,
  } = loaderData;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const error = actionData?.error;

  const hardcoverDone = !!hardcoverApiKey;
  const libraryDone = !!libraryKey;
  const allDone = hardcoverDone && libraryDone;

  return (
    <main className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 dark:from-gray-950 dark:to-gray-900 py-12 px-4">
      <div className="max-w-lg mx-auto space-y-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          Setup
        </h1>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4 text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Step 1: Hardcover API Key */}
        <section className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg">
          <div className="flex items-center gap-3 mb-4">
            <span
              className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${hardcoverDone ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"}`}
            >
              {hardcoverDone ? "\u2713" : "1"}
            </span>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              Hardcover API Key
            </h2>
          </div>

          {hardcoverDone ? (
            <div className="flex items-center justify-between">
              <p className="text-green-600 dark:text-green-400">
                Connected! API key saved.
              </p>
              <Form method="post">
                <input type="hidden" name="intent" value="clearHardcover" />
                <button
                  type="submit"
                  className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 underline"
                >
                  Change
                </button>
              </Form>
            </div>
          ) : (
            <>
              <p className="text-gray-600 dark:text-gray-400 mb-4 text-sm">
                Get your API key from{" "}
                <a
                  href="https://hardcover.app/account/api"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amber-600 hover:text-amber-700 underline"
                >
                  hardcover.app/account/api
                </a>
              </p>
              <Form method="post">
                <input type="hidden" name="intent" value="saveHardcover" />
                <div className="flex gap-2">
                  <input
                    type="password"
                    name="apiKey"
                    placeholder="Paste your API key"
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400"
                    required
                  />
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
                  >
                    {isSubmitting ? "Verifying..." : "Connect"}
                  </button>
                </div>
              </Form>
            </>
          )}
        </section>

        {/* Step 2: Library Selection */}
        <section className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg">
          <div className="flex items-center gap-3 mb-4">
            <span
              className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${libraryDone ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" : "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"}`}
            >
              {libraryDone ? "\u2713" : "2"}
            </span>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              Libby Library
            </h2>
          </div>

          {libraryDone ? (
            <div className="flex items-center justify-between">
              <p className="text-green-600 dark:text-green-400">
                Connected to <span className="font-medium">{libraryName || libraryKey}</span>
              </p>
              <Form method="post">
                <input type="hidden" name="intent" value="clearLibrary" />
                <button
                  type="submit"
                  className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 underline"
                >
                  Change
                </button>
              </Form>
            </div>
          ) : (
            <>
              <p className="text-gray-600 dark:text-gray-400 mb-4 text-sm">
                Search for your local library to check availability through
                Libby.
              </p>
              <Form method="get" className="mb-4">
                <div className="flex gap-2">
                  <input
                    type="text"
                    name="libraryQuery"
                    defaultValue={libraryQuery}
                    placeholder="Search for your library..."
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                  >
                    Search
                  </button>
                </div>
              </Form>

              {libraries.length > 0 && (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {libraries.map((lib) => (
                    <Form method="post" key={lib.id}>
                      <input
                        type="hidden"
                        name="intent"
                        value="saveLibrary"
                      />
                      <input
                        type="hidden"
                        name="libraryKey"
                        value={lib.fulfillmentId}
                      />
                      <input
                        type="hidden"
                        name="libraryName"
                        value={lib.name}
                      />
                      <button
                        type="submit"
                        className="w-full text-left p-3 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                      >
                        <span className="font-medium text-gray-900 dark:text-white">
                          {lib.name}
                        </span>
                        {lib.type && (
                          <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">
                            {lib.type}
                          </span>
                        )}
                      </button>
                    </Form>
                  ))}
                </div>
              )}

              {libraryQuery && libraries.length === 0 && (
                <p className="text-gray-500 dark:text-gray-400 text-sm">
                  No libraries found. Try a different search term.
                </p>
              )}
            </>
          )}
        </section>

        {/* Actions */}
        <div className="flex gap-3">
          {allDone && (
            <a
              href="/books"
              className="flex-1 text-center px-6 py-3 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg transition-colors"
            >
              View Available Books
            </a>
          )}
          {(hardcoverDone || libraryDone) && (
            <Form method="post">
              <input type="hidden" name="intent" value="clearAll" />
              <button
                type="submit"
                className="px-4 py-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Reset
              </button>
            </Form>
          )}
        </div>
      </div>
    </main>
  );
}
