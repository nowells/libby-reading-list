import { createCookieSessionStorage } from "react-router";

export const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "__hardcoverlibby",
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secrets: [process.env.SESSION_SECRET || "dev-secret-change-me"],
    secure: process.env.COOKIE_SECURE === "true",
  },
});

export async function getSession(request: Request) {
  return sessionStorage.getSession(request.headers.get("Cookie"));
}

export async function commitSession(
  ...args: Parameters<typeof sessionStorage.commitSession>
) {
  return sessionStorage.commitSession(...args);
}
