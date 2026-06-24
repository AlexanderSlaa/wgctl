import { Router, json, error } from "@sourceregistry/node-webserver";
import type { LoginRequest, LoginResponse } from "../../shared/index.js";
import { verifyCredentials } from "../db/users.repo.js";
import { createSession } from "../auth/session.js";

export const authRoutes = new Router();

authRoutes.POST("/auth/login", async (event) => {
  const body = (await event.request.json()) as LoginRequest;
  if (!body?.username || !body?.password) {
    error(400, { message: "username and password are required" });
  }
  const user = verifyCredentials(body.username, body.password);
  if (!user) {
    error(401, { message: "Invalid credentials" });
  }
  const { token, expiresAt } = createSession(user.username);
  const response: LoginResponse = { token, username: user.username, expiresAt };
  return json(response, { status: 200 });
});
