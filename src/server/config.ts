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
  dbPath: process.env.DB_PATH ?? "/etc/wgctl/db.sqlite",
  wgInterface: process.env.WG_INTERFACE ?? "wg0",
  wgConfPath: process.env.WG_CONF_PATH ?? "/etc/wireguard/wg0.conf",
  wgListenPort: Number(process.env.WG_LISTEN_PORT ?? 51820),
  wgSubnet: process.env.WG_SUBNET ?? "10.88.0.0/24",
  wgServerAddress: process.env.WG_SERVER_ADDRESS ?? "10.88.0.1/24",
  sysctlFile: process.env.SYSCTL_FILE ?? "/etc/sysctl.d/99-wgctl.conf",
  persistentKeepalive: Number(process.env.PERSISTENT_KEEPALIVE ?? 25),
  /**
   * The host part of the endpoint handed to clients. Prefers explicit
   * PUBLIC_HOST (required if this box sits behind NAT/port-forwarding)
   * and otherwise falls back to the first non-internal IPv4 address found
   * locally, with a one-time warning.
   */
  get publicHost(): string {
    if (process.env.PUBLIC_HOST) return process.env.PUBLIC_HOST;
    const detected = detectPublicHost();
    if (!detected) {
      throw new Error(
        "Could not auto-detect a public IP address and PUBLIC_HOST is not set. " +
          "Set PUBLIC_HOST to the address/hostname peers should connect to.",
      );
    }
    if (!warnedAboutAutoDetect) {
      console.warn(
        `PUBLIC_HOST not set — auto-detected ${detected}. If this box has multiple interfaces or sits behind NAT, ` +
          `set PUBLIC_HOST explicitly in the env file.`,
      );
      warnedAboutAutoDetect = true;
    }
    return detected;
  },
};
