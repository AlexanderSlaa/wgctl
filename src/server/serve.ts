import { bootstrapWireGuard } from "./wg/bootstrap.js";
import { ensureTlsCertificate } from "./tls.js";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { cleanupExpiredSessions } from "./auth/session.js";

function parseFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}

export async function serveCommand(args: string[] = []): Promise<void> {
  ensureTlsCertificate();
  cleanupExpiredSessions();

  try {
    await bootstrapWireGuard();
  } catch (err: any) {
    if (err?.code === "ENOENT" && err?.path === config.wgConfPath) {
      console.error(
        `No WireGuard config found at ${config.wgConfPath}.\n\nRun: wgctl setup\n`,
      );
    } else if (err instanceof Error && err.message.startsWith("Required command `")) {
      console.error(err.message);
    } else {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`WireGuard bootstrap failed — refusing to serve against a half-configured tunnel:\n\n${message}`);
    }
    process.exit(1);
  }

  const port = Number(parseFlag(args, "--port") ?? config.port);
  const host = parseFlag(args, "--host") ?? config.host;

  const app = createApp();
  app.listen(port, host, () => {
    console.log(`wgctl listening on https://${host ?? "0.0.0.0"}:${port}`);
  });
}
