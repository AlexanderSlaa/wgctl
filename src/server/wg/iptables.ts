import { ensureForwarding } from "../../shared/index.js";
import { config } from "../config.js";

/** Re-applies the FORWARD rule + ip_forward sysctl for the managed interface. Must run on every boot — neither survives a reboot. */
export function ensureNetworkForwarding(): void {
  ensureForwarding(config.wgInterface, config.sysctlFile);
}
