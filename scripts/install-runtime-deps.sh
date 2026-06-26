#!/usr/bin/env bash
# On x86_64/aarch64 Linux, @sourceregistry/node-wireguard ships a prebuilt
# native addon and `npm install` skips building entirely — but that prebuild
# still dynamically links against libmnl/OpenSSL libcrypto at runtime, so these
# shared libraries need to be installed even though nothing gets compiled.
# This is the only native dependency most installs need; no compiler or
# headers required. Idempotent.
set -euo pipefail

apt-get update
apt-get install -y --no-install-recommends \
  libmnl0 \
  openssl \
  iptables \
  procps
