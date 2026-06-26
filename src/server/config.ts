// All server configuration comes from environment variables, with
// reasonable defaults for a single-box deployment so `wgctl serve` works
// out of the box after a global install.

import { networkInterfaces } from "node:os";

function detectPublicHost(): string | undefined {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }
  return undefined;
}

let warnedAboutAutoDetect = false;

export const config = {
  port: Number(process.env.PORT ?? 8443),
  /** Bind address for the HTTPS control-plane API. Undefined = listen on all interfaces (the default). */
  host: process.env.HOST || undefined,
  dbPath: process.env.DB_PATH ?? "/etc/wgctl/db.sqlite",
  wgInterface: process.env.WG_INTERFACE ?? "wg0",
  wgConfPath: process.env.WG_CONF_PATH ?? "/etc/wireguard/wg0.conf",
  wgListenPort: Number(process.env.WG_LISTEN_PORT ?? 51820),
  wgSubnet: process.env.WG_SUBNET ?? "10.88.0.0/24",
  wgServerAddress: process.env.WG_SERVER_ADDRESS ?? "10.88.0.1/24",
  migratedSnapshotPath: process.env.WG_MIGRATED_SNAPSHOT_PATH ?? "/etc/wireguard/wg0-migrated.json",
  sysctlFile: process.env.SYSCTL_FILE ?? "/etc/sysctl.d/99-wgctl.conf",
  tlsCertPath: process.env.TLS_CERT_PATH ?? "/etc/wgctl/tls/cert.pem",
  tlsKeyPath: process.env.TLS_KEY_PATH ?? "/etc/wgctl/tls/key.pem",
  setupToken: process.env.WGCTL_SETUP_TOKEN || undefined,
  setupUsername: process.env.WGCTL_SETUP_USERNAME || "admin",
  sessionTtlMs: Number(process.env.SESSION_TTL_MS ?? 7 * 24 * 60 * 60 * 1000),
  persistentKeepalive: Number(process.env.PERSISTENT_KEEPALIVE ?? 25),
  /**
   * The host part of the endpoint handed to clients. Prefers explicit
   * PUBLIC_HOST (required if this box has multiple external interfaces or
   * sits behind NAT/port-forwarding, since there's no reliable way to guess
   * "the" right address in that case) and otherwise falls back to the first
   * non-internal IPv4 address found locally, with a one-time warning.
   */
  get publicHost(): string {
    if (process.env.PUBLIC_HOST) return process.env.PUBLIC_HOST;
    const detected = detectPublicHost();
    if (!detected) {
      throw new Error(
        "Could not auto-detect a public IP address and PUBLIC_HOST is not set. " +
          "Set PUBLIC_HOST to the address/hostname clients should connect to.",
      );
    }
    if (!warnedAboutAutoDetect) {
      console.warn(
        `PUBLIC_HOST not set — auto-detected ${detected}. If this box has multiple interfaces, sits behind NAT, ` +
          `or clients should use a different hostname, set PUBLIC_HOST explicitly.`,
      );
      warnedAboutAutoDetect = true;
    }
    return detected;
  },
};
