#!/usr/bin/env bash
# Optional: `wgctl serve` auto-generates a self-signed certificate on first
# run if one doesn't exist. Use this script instead if you want to customize
# the CN/validity period before the first launch. The CLI pins the
# certificate's fingerprint on first login (trust-on-first-use) rather than
# relying on a CA chain.
set -euo pipefail

CERT_DIR="${TLS_DIR:-/etc/wgctl/tls}"
DAYS="${TLS_DAYS:-3650}"
CN="${TLS_COMMON_NAME:-$(hostname -f 2>/dev/null || hostname)}"

mkdir -p "$CERT_DIR"

if [[ -f "$CERT_DIR/cert.pem" && -f "$CERT_DIR/key.pem" ]]; then
  echo "Certificate already exists at $CERT_DIR — leaving it in place. Delete it manually to regenerate."
  exit 0
fi

openssl req -x509 -newkey rsa:4096 -nodes \
  -keyout "$CERT_DIR/key.pem" \
  -out "$CERT_DIR/cert.pem" \
  -days "$DAYS" \
  -subj "/CN=${CN}"

chmod 600 "$CERT_DIR/key.pem"
chmod 644 "$CERT_DIR/cert.pem"

echo "Self-signed certificate generated at $CERT_DIR (CN=${CN}, valid ${DAYS} days)."
echo "Fingerprint (for manual verification): "
openssl x509 -in "$CERT_DIR/cert.pem" -noout -fingerprint -sha256
