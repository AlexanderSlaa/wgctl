import { error } from "@sourceregistry/node-webserver";
import type { RequestEvent } from "@sourceregistry/node-webserver";
import { lookupSession } from "./session.js";

export interface AuthContext {
  user: { username: string; role: "user" | "admin" };
}

// Deliberately not annotated with the full EventEnhancer<...> type: that
// signature's return type always includes `Response | void` (to allow
// short-circuiting), which would widen `event.context` for every route using
// this enhancer. Since `error()` is typed as returning `never`, leaving the
// return type to be inferred from the function body gives callers the
// narrow `AuthContext` they actually get when no error was thrown.
export function withAuth(event: RequestEvent): AuthContext {
  const authHeader = event.request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : undefined;
  if (!token) {
    error(401, { message: "Unauthorized" });
  }
  const session = lookupSession(token);
  if (!session) {
    error(401, { message: "Invalid or expired token" });
  }
  return { user: session };
}

export * from "./session.js";
export * from "./password.js";
