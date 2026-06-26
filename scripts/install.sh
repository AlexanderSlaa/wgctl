#!/usr/bin/env bash
# One-command Debian/Ubuntu installer for a fresh wgctl server.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/AlexanderSlaa/wgctl/main/scripts/install.sh | sudo bash
#
# Optional environment:
#   WGCTL_VERSION=1.6.0  Install a specific npm version instead of latest.
#   RUN_SETUP=0         Install only; do not launch `wgctl setup`.
set -euo pipefail

WGCTL_VERSION="${WGCTL_VERSION:-latest}"
RUN_SETUP="${RUN_SETUP:-1}"
NODE_MAJOR="22"

log() {
  printf '\n==> %s\n' "$*"
}

die() {
  printf 'wgctl install: %s\n' "$*" >&2
  exit 1
}

if [ "$(id -u)" -ne 0 ]; then
  die "run as root, for example: curl -fsSL https://raw.githubusercontent.com/AlexanderSlaa/wgctl/main/scripts/install.sh | sudo bash"
fi

if ! command -v apt-get >/dev/null 2>&1; then
  die "this installer currently supports Debian/Ubuntu systems with apt-get"
fi

. /etc/os-release 2>/dev/null || die "could not read /etc/os-release"
case "${ID:-}" in
  debian | ubuntu) ;;
  *)
    case " ${ID_LIKE:-} " in
      *" debian "*) ;;
      *) die "unsupported distribution: ${PRETTY_NAME:-unknown}. Install manually with npm install -g wgctl." ;;
    esac
    ;;
esac

node_major() {
  node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || printf '0\n'
}

log "Installing wgctl runtime dependencies"
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  gnupg \
  libmnl0 \
  openssl \
  iptables \
  procps

if ! command -v node >/dev/null 2>&1 || [ "$(node_major)" -lt "$NODE_MAJOR" ]; then
  log "Installing Node.js ${NODE_MAJOR}.x"
  install -d -m 0755 /etc/apt/keyrings
  tmp_key="$(mktemp)"
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key -o "$tmp_key"
  rm -f /etc/apt/keyrings/nodesource.gpg
  gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg "$tmp_key"
  rm -f "$tmp_key"
  chmod 0644 /etc/apt/keyrings/nodesource.gpg
  printf 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_%s.x nodistro main\n' "$NODE_MAJOR" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y --no-install-recommends nodejs
else
  log "Node.js $(node -v) is already installed"
fi

log "Installing wgctl@${WGCTL_VERSION}"
npm install -g "wgctl@${WGCTL_VERSION}"

if [ "$RUN_SETUP" = "0" ]; then
  log "Install complete"
  printf 'Run setup when ready: sudo wgctl setup\n'
  exit 0
fi

if [ -r /dev/tty ] && [ -w /dev/tty ]; then
  log "Starting wgctl setup"
  wgctl setup < /dev/tty > /dev/tty
else
  log "Install complete"
  printf 'No interactive terminal was available. Run setup manually: sudo wgctl setup\n'
fi
