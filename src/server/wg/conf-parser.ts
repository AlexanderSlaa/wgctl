import { readFileSync } from "node:fs";

export interface ParsedWgQuickPeer {
  publicKey: string;
  presharedKey?: string;
  allowedIPs: string[];
}

export interface ParsedWgQuickConf {
  privateKey: string;
  listenPort: number;
  address: string;
  peers: ParsedWgQuickPeer[];
}

/**
 * Minimal line-based parser for a wg-quick .conf file. Deliberately not a
 * general-purpose INI parser — this only needs to understand the fixed,
 * known shape of a wg-quick config (one [Interface] section, zero or more
 * [Peer] sections), which is all that's needed to extract the existing
 * server identity and static peers during the one-time takeover.
 */
export function parseWgQuickConf(path: string): ParsedWgQuickConf {
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n").map((l) => l.trim());

  let privateKey: string | undefined;
  let listenPort: number | undefined;
  let address: string | undefined;
  const peers: ParsedWgQuickPeer[] = [];

  let section: "interface" | "peer" | null = null;
  let currentPeer: Partial<ParsedWgQuickPeer> | null = null;

  const flushPeer = () => {
    if (currentPeer?.publicKey && currentPeer.allowedIPs) {
      peers.push({
        publicKey: currentPeer.publicKey,
        presharedKey: currentPeer.presharedKey,
        allowedIPs: currentPeer.allowedIPs,
      });
    }
    currentPeer = null;
  };

  for (const rawLine of lines) {
    if (!rawLine || rawLine.startsWith("#")) continue;

    if (rawLine === "[Interface]") {
      section = "interface";
      continue;
    }
    if (rawLine === "[Peer]") {
      flushPeer();
      section = "peer";
      currentPeer = {};
      continue;
    }

    const eq = rawLine.indexOf("=");
    if (eq === -1) continue;
    const key = rawLine.slice(0, eq).trim();
    const value = rawLine.slice(eq + 1).trim();

    if (section === "interface") {
      if (key === "PrivateKey") privateKey = value;
      else if (key === "ListenPort") listenPort = Number(value);
      else if (key === "Address") address = value;
    } else if (section === "peer" && currentPeer) {
      if (key === "PublicKey") currentPeer.publicKey = value;
      else if (key === "PresharedKey") currentPeer.presharedKey = value;
      else if (key === "AllowedIPs") {
        currentPeer.allowedIPs = value.split(",").map((s) => s.trim());
      }
    }
  }
  flushPeer();

  if (!privateKey || !listenPort || !address) {
    throw new Error(`Failed to parse required [Interface] fields from ${path}`);
  }

  return { privateKey, listenPort, address, peers };
}
