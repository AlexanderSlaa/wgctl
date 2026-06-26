import { bootstrapWireGuard } from "./wg/bootstrap.js";
import { config } from "./config.js";

export async function serveCommand(): Promise<void> {
  try {
    await bootstrapWireGuard();
  } catch (err: any) {
    if (err?.code === "ENOENT" && err?.path === config.wgConfPath) {
      console.error(`No WireGuard config found at ${config.wgConfPath}.\n\nRun: wgctl setup\n`);
    } else if (err instanceof Error && err.message.startsWith("Required command `")) {
      console.error(err.message);
    } else {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`WireGuard bootstrap failed — refusing to start against a half-configured tunnel:\n\n${message}`);
    }
    process.exit(1);
  }

  console.log(`wgctl serving on ${config.wgInterface} (${config.wgServerAddress})`);

  // Stay alive so systemd keeps the unit active. WireGuard kernel state
  // persists independently; this process just holds the unit in active state
  // and can reconcile peers on future SIGHUP if needed.
  await new Promise<void>((resolve) => {
    process.on("SIGTERM", resolve);
    process.on("SIGINT", resolve);
  });

  console.log("wgctl shutting down.");
}
