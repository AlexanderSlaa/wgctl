import { bootstrapWireGuard } from "./wg/bootstrap.js";
import { ensureTlsCertificate } from "./tls.js";
import { createApp } from "./app.js";
import { config } from "./config.js";

function parseFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}

export async function serveCommand(args: string[] = []): Promise<void> {
  ensureTlsCertificate();

  try {
    await bootstrapWireGuard();
  } catch (err) {
    console.error("WireGuard bootstrap failed — refusing to serve against a half-configured tunnel:", err);
    process.exit(1);
  }

  const port = Number(parseFlag(args, "--port") ?? config.port);
  const host = parseFlag(args, "--host") ?? config.host;

  const app = createApp();
  app.listen(port, host, () => {
    console.log(`wgctl listening on https://${host ?? "0.0.0.0"}:${port}`);
  });
}
