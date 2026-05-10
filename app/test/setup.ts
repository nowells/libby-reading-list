import { beforeAll, afterEach, afterAll } from "vitest";
import { setupWorker } from "msw/browser";
import { handlers } from "./msw/handlers";
import { __resetAvailabilityCacheForTest } from "~/routes/books/lib/cache";
import { __resetAuthorCacheForTest } from "~/routes/authors/lib/cache";
import "~/app.css";

const worker = setupWorker(...handlers);

beforeAll(async () => {
  await worker.start({ onUnhandledRequest: "bypass", quiet: true });
});

afterEach(async () => {
  worker.resetHandlers();
  localStorage.clear();
  // The availability caches are module-level singletons backed by IDB. Reset
  // them so cached entries from one test don't bleed into the next and turn
  // a "done" status check into a "cached" one.
  await Promise.all([__resetAvailabilityCacheForTest(), __resetAuthorCacheForTest()]);
});

afterAll(() => {
  worker.stop();
});

export { worker };
