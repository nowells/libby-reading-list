import { beforeAll, afterEach, afterAll } from "vitest";
import { setupWorker } from "msw/browser";
import { handlers } from "./msw/handlers";
import "~/app.css";

const worker = setupWorker(...handlers);

beforeAll(async () => {
  await worker.start({ onUnhandledRequest: "bypass", quiet: true });
});

afterEach(() => {
  worker.resetHandlers();
  localStorage.clear();
});

afterAll(() => {
  worker.stop();
});

export { worker };
