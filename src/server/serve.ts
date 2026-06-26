import { bootstrapWireGuard } from "./wg/bootstrap.js";
import { config } from "./config.js";

export async function serveCommand(): Promise<void> {
  try {
    bootstrapWireGuard();
  } catch (err: any) {
    if (err?.code === "ENOENT" && err?.path === config.wgConfPath) {
      console.error(`No WireGuard config found at ${config.wgConfPath}.\n\nRun: wgctl setup\n`);
    } else {
      console.error(`WireGuard bootstrap failed:\n\n${err instanceof Error ? err.message : String(err)}`);
    }
    process.exit(1);
  }

  console.log(`wgctl serving on ${config.wgInterface} (${config.wgServerAddress})`);

  await new Promise<void>((resolve) => {
    process.on("SIGTERM", resolve);
    process.on("SIGINT", resolve);
  });

  console.log("wgctl shutting down.");
}
