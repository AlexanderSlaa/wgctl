// Pure IPv4 CIDR math. No dependencies — used by both the server (IP pool,
// subnet overlap validation) and the CLI (validating user-entered advertised
// subnets before sending them to the server).

export interface ParsedCidr {
  base: number; // network address as a 32-bit unsigned int
  prefixLength: number;
  mask: number; // 32-bit mask, e.g. /24 -> 0xFFFFFF00
}

function ipToInt(ip: string): number {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    throw new Error(`Invalid IPv4 address: ${ip}`);
  }
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      throw new Error(`Invalid IPv4 address: ${ip}`);
    }
    value = (value << 8) | octet;
  }
  return value >>> 0;
}

function intToIp(value: number): string {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].join(".");
}

export function isValidCidr(cidr: string): boolean {
  try {
    parseCidr(cidr);
    return true;
  } catch {
    return false;
  }
}

export function parseCidr(cidr: string): ParsedCidr {
  const [ip, prefixStr] = cidr.split("/");
  if (!ip || prefixStr === undefined) {
    throw new Error(`Invalid CIDR (expected "a.b.c.d/n"): ${cidr}`);
  }
  const prefixLength = Number(prefixStr);
  if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > 32) {
    throw new Error(`Invalid CIDR prefix length: ${cidr}`);
  }
  const addr = ipToInt(ip);
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  const base = (addr & mask) >>> 0;
  return { base, prefixLength, mask };
}

/** True if the two CIDR ranges overlap at all (in either direction). */
export function cidrsOverlap(a: string, b: string): boolean {
  const pa = parseCidr(a);
  const pb = parseCidr(b);
  const widerMask = pa.prefixLength <= pb.prefixLength ? pa.mask : pb.mask;
  return (pa.base & widerMask) === (pb.base & widerMask);
}

export function cidrContainsIp(cidr: string, ip: string) {
  const p = parseCidr(cidr);
  return (ipToInt(ip) & p.mask) === p.base;
}

/** Number of usable host addresses in a /prefixLength range (excludes none — caller handles network/broadcast reservation). */
export function hostCount(prefixLength: number): number {
  return 2 ** (32 - prefixLength);
}

export function hostAtOffset(cidr: string, offset: number): string {
  const p = parseCidr(cidr);
  if (offset < 0 || offset >= hostCount(p.prefixLength)) {
    throw new Error(`Offset ${offset} out of range for ${cidr}`);
  }
  return intToIp((p.base + offset) >>> 0);
}
