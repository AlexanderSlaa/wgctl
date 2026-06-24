import { readFileSync } from "node:fs";
import { WebServer, Security, RequestId, Timeout } from "@sourceregistry/node-webserver";
import { config } from "./config.js";
import { buildApiRouter } from "./routes/index.js";

export function createApp(): WebServer {
  const app = new WebServer({
    type: "https",
    options: {
      cert: readFileSync(config.tlsCertPath),
      key: readFileSync(config.tlsKeyPath),
    },
    security: {
      maxRequestBodySize: 64 * 1024,
    },
  });

  app.useMiddleware(RequestId.assign());
  app.useMiddleware(Security.headers());
  app.useMiddleware(Timeout.deadline({ ms: 10_000 }));

  app.use("/api", buildApiRouter());

  return app;
}
