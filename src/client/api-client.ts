import type {
  LoginRequest,
  LoginResponse,
  NetworksResponse,
  RegisterPeerRequest,
  RegisterPeerResponse,
  PeerStatusResponse,
  ErrorResponse,
} from "../shared/index.js";
import { secureRequest } from "./https-client.js";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(
  serverUrl: string,
  path: string,
  opts: { method?: string; body?: unknown; token?: string; expectedFingerprint?: string } = {},
): Promise<{ data: T; fingerprint: string }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;

  const res = await secureRequest(new URL(path, serverUrl).toString(), {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    expectedFingerprint: opts.expectedFingerprint,
  });

  if (res.status < 200 || res.status >= 300) {
    const parsed = res.body ? (JSON.parse(res.body) as ErrorResponse) : { message: `HTTP ${res.status}` };
    throw new ApiError(res.status, parsed.message);
  }
  const data = res.status === 204 || !res.body ? (undefined as T) : (JSON.parse(res.body) as T);
  return { data, fingerprint: res.fingerprint };
}

/**
 * Authenticates against the server.
 * `expectedFingerprint` must be provided and pre-verified by the caller — credentials
 * are only sent once the TLS certificate has been confirmed out-of-band.
 */
export async function login(
  serverUrl: string,
  body: LoginRequest,
  expectedFingerprint: string,
): Promise<LoginResponse & { certFingerprint: string }> {
  const { data, fingerprint } = await request<LoginResponse>(serverUrl, "/api/auth/login", {
    method: "POST",
    body,
    expectedFingerprint,
  });
  return { ...data, certFingerprint: fingerprint };
}

/** Revokes the current session on the server. Best-effort — errors are ignored. */
export async function logout(serverUrl: string, token: string, expectedFingerprint: string): Promise<void> {
  await request<void>(serverUrl, "/api/auth/session", { method: "DELETE", token, expectedFingerprint });
}

export async function getNetworks(serverUrl: string, token: string, expectedFingerprint: string): Promise<NetworksResponse> {
  return (await request<NetworksResponse>(serverUrl, "/api/networks", { token, expectedFingerprint })).data;
}

export async function registerPeer(
  serverUrl: string,
  token: string,
  expectedFingerprint: string,
  body: RegisterPeerRequest,
): Promise<RegisterPeerResponse> {
  return (await request<RegisterPeerResponse>(serverUrl, "/api/peers", { method: "POST", body, token, expectedFingerprint })).data;
}

export async function deletePeer(serverUrl: string, token: string, expectedFingerprint: string, id: number): Promise<void> {
  await request<void>(serverUrl, `/api/peers/${id}`, { method: "DELETE", token, expectedFingerprint });
}

export async function getMyPeer(serverUrl: string, token: string, expectedFingerprint: string): Promise<PeerStatusResponse> {
  return (await request<PeerStatusResponse>(serverUrl, "/api/peers/me", { token, expectedFingerprint })).data;
}
