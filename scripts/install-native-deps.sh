#!/usr/bin/env bash
# Full native build toolchain — only needed as a fallback on a platform
# without a published @sourceregistry/node-wireguard prebuild (x86_64/aarch64
# Linux have one; `npm install` then builds from source automatically and
# needs this). If you're on a supported platform and just hit a missing
# libmnl/OpenSSL *runtime* error, you want scripts/install-runtime-deps.sh
# instead — it's much lighter (no compiler, no headers).
set -euo pipefail

apt-get update
apt-get install -y --no-install-recommends \
  build-essential \
  pkg-config \
  libmnl-dev \
  libssl-dev
