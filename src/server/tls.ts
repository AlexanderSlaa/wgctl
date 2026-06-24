// Auto-generates a self-signed TLS certificate on first `wgctl serve` run if
// one doesn't already exist at the configured paths, so a fresh global
// install needs no manual setup step. The CLI pins the certificate's
// fingerprint on first login (trust-on-first-use) rather than relying on a
// CA chain, so a self-signed cert is an acceptable permanent posture here,
// not just a placeholder.

import { existsSync, mkdirSync, chmodSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { hostname } from "node:os";
import { config } from "./config.js";

export function ensureTlsCertificate(): void {
  if (existsSync(config.tlsCertPath) && existsSync(config.tlsKeyPath)) {
    return;
  }

  mkdirSync(dirname(config.tlsCertPath), { recursive: true });
  mkdirSync(dirname(config.tlsKeyPath), { recursive: true });

  console.log(`No TLS certificate found at ${config.tlsCertPath} — generating a self-signed one...`);
  execFileSync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:4096",
    "-nodes",
    "-keyout",
    config.tlsKeyPath,
    "-out",
    config.tlsCertPath,
    "-days",
    "3650",
    "-subj",
    `/CN=${hostname()}`,
  ]);
  chmodSync(config.tlsKeyPath, 0o600);

  const fingerprint = execFileSync("openssl", ["x509", "-in", config.tlsCertPath, "-noout", "-fingerprint", "-sha256"])
    .toString()
    .trim();
  console.log(`Generated self-signed certificate at ${config.tlsCertPath}. ${fingerprint}`);
}
