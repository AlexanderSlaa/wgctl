// Single source of truth for the HTTP contract between packages/server and packages/cli.

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  username: string;
  expiresAt: string; // ISO 8601
}

export interface NetworkDto {
  id: number;
  name: string;
  cidr: string;
  description: string | null;
}

export interface NetworksResponse {
  networks: NetworkDto[];
}

export interface RegisterPeerRequest {
  publicKey: string;
  networkIds: number[];
  advertisedSubnets: string[];
}

export interface RegisterPeerResponse {
  serverPublicKey: string;
  /** "<host>:<port>" of this server's WireGuard UDP listener. */
  endpoint: string;
  /**
   * The address (with prefix length, e.g. "10.88.0.5/24") the CLI should pass
   * to setAddress() on its own local wg0 interface. Carries the pool's prefix
   * length so on-link routing of relayed peer traffic works correctly — this
   * is distinct from the /32 the server uses internally for this peer's own
   * AllowedIPs entry, which the CLI never needs to see.
   */
  clientAddress: string;
  /**
   * AllowedIPs the CLI should set on its local peer entry pointing at the
   * server: the server's tunnel subnet plus every selected network's CIDR.
   * NOT the same list the server pushes to the kernel for this peer (see
   * WgManager docs) — do not conflate the two directions.
   */
  allowedIPs: string[];
  persistentKeepalive: number;
}

export interface PeerStatusResponse {
  id: number;
  publicKey: string;
  tunnelIp: string;
  networkIds: number[];
  advertisedSubnets: string[];
  lastHandshake: string | null; // ISO 8601
  rxBytes: string; // bigint serialized as string
  txBytes: string;
}

export interface ErrorResponse {
  message: string;
}
