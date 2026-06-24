import { bootstrapWireGuard } from "./wg/bootstrap.js";
import { ensureTlsCertificate } from "./tls.js";
import { createApp } from "./app.js";
import { config } from "./config.js";

export async function serveCommand(): Promise<void> {
  ensureTlsCertificate();

  try {
    await bootstrapWireGuard();
  } catch (err) {
    console.error("WireGuard bootstrap failed — refusing to serve against a half-configured tunnel:", err);
    process.exit(1);
  }

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`wgctl listening on https://0.0.0.0:${config.port}`);
  });
}
