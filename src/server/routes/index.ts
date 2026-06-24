import { Router } from "@sourceregistry/node-webserver";
import { authRoutes } from "./auth.routes.js";
import { networksRoutes } from "./networks.routes.js";
import { peersRoutes } from "./peers.routes.js";

export function buildApiRouter(): Router {
  const api = new Router();
  api.use(authRoutes);
  api.use(networksRoutes);
  api.use(peersRoutes);
  return api;
}
