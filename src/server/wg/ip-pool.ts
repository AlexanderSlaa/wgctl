import { hostAtOffset, hostCount, parseCidr } from "../../shared/index.js";

/**
 * Allocates the lowest free host address in `subnet`, skipping the network
 * address (offset 0), broadcast address (last offset), and any offsets
 * reserved for fixed assignments (e.g. the server itself, a static peer).
 * `usedIps` is the full set of addresses already handed out (from the
 * `peers` table) plus any reserved addresses.
 */
export function allocateNextIp(subnet: string, usedIps: Set<string>, reservedOffsets: number[] = []): string {
  const { prefixLength } = parseCidr(subnet);
  const total = hostCount(prefixLength);
  const reserved = new Set<number>([0, total - 1, ...reservedOffsets]);
  for (let offset = 1; offset < total - 1; offset++) {
    if (reserved.has(offset)) continue;
    const candidate = hostAtOffset(subnet, offset);
    if (!usedIps.has(candidate)) {
      return candidate;
    }
  }
  throw new Error(`No free IP addresses remaining in subnet ${subnet}`);
}
