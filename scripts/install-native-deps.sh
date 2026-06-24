#!/usr/bin/env bash
# Installs the native build toolchain needed to compile @sourceregistry/node-wireguard's
# N-API addon from source, in case npm can't find a matching prebuild for this
# platform/Node ABI combination. Idempotent (apt-get install is a no-op if already present).
set -euo pipefail

apt-get update
apt-get install -y --no-install-recommends \
  build-essential \
  pkg-config \
  libmnl-dev \
  libsodium-dev
