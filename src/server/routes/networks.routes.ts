import { Router, json, enhance } from "@sourceregistry/node-webserver";
import type { NetworksResponse } from "../../shared/index.js";
import { withAuth } from "../auth/index.js";
import { findUserByUsername } from "../db/users.repo.js";
import { listNetworksForUser } from "../db/networks.repo.js";

export const networksRoutes = new Router();

networksRoutes.GET(
  "/networks",
  enhance(async (event) => {
    const user = findUserByUsername(event.context.user.username)!;
    const networks = listNetworksForUser(user.id);
    const response: NetworksResponse = {
      networks: networks.map((n) => ({ id: n.id, name: n.name, cidr: n.cidr, description: n.description })),
    };
    return json(response, { status: 200 });
  }, withAuth),
);
