// Trust-on-first-use HTTPS client for the CLI. The server uses a
// self-signed certificate (no CA chain to validate), so we can't rely on
// Node's normal certificate validation — instead we pin the certificate's
// SHA-256 fingerprint on first login and verify every subsequent request
// against it. This is stronger than globally disabling TLS verification
// (NODE_TLS_REJECT_UNAUTHORIZED=0), which would accept *any* certificate
// from anyone claiming to be the server.

import { request as httpsRequest } from "node:https";
import type { TLSSocket } from "node:tls";

export interface SecureResponse {
  status: number;
  fingerprint: string;
  body: string;
}

export interface SecureRequestOptions {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  /** If provided, the connection is aborted unless the server's cert fingerprint matches exactly. If omitted, any fingerprint is accepted and returned (trust-on-first-use capture). */
  expectedFingerprint?: string;
}

export function secureRequest(url: string, options: SecureRequestOptions = {}): Promise<SecureResponse> {
  const target = new URL(url);

  return new Promise((resolve, reject) => {
    let fingerprint = "";
    let mismatchError: Error | undefined;

    const req = httpsRequest(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: target.pathname + target.search,
        method: options.method ?? "GET",
        headers: options.headers,
        rejectUnauthorized: false,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (mismatchError) {
            reject(mismatchError);
            return;
          }
          resolve({ status: res.statusCode ?? 0, fingerprint, body: data });
        });
      },
    );

    req.on("socket", (socket: TLSSocket) => {
      socket.on("secureConnect", () => {
        const cert = socket.getPeerCertificate();
        fingerprint = cert.fingerprint256 ?? "";
        if (options.expectedFingerprint && fingerprint !== options.expectedFingerprint) {
          mismatchError = new Error(
            `TLS certificate fingerprint mismatch for ${target.hostname} — expected ${options.expectedFingerprint}, got ${fingerprint}. ` +
              `Refusing to send credentials/tokens to a server presenting an unexpected certificate.`,
          );
          socket.destroy(mismatchError);
        }
      });
    });

    req.on("error", (err) => reject(mismatchError ?? err));

    if (options.body) req.write(options.body);
    req.end();
  });
}
