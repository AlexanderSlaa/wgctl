#!/bin/sh
# Entrypoint for the wgctl container image.
#
# Two modes:
#   - Admin passthrough: `docker run wgctl peer add alice ...` (or
#     `kubectl exec ... -- wgctl status`) runs the given wgctl subcommand
#     and exits — same as installing wgctl on a host.
#   - Default (the image's CMD, "hub", or no args): brings the WireGuard
#     interface up — running `wgctl join` if JOIN_TOKEN is set, otherwise
#     `wgctl setup` on first start if unconfigured — and stays in the
#     foreground so the container has something to run. wgctl has no
#     daemon of its own (see AGENTS.md); the interface is brought up once
#     via wg-quick and then just sits in the kernel, so this script's job
#     is purely to give the container a foreground process and a clean
#     shutdown path.
set -eu

WGCTL="node /app/dist/main.js"
export WG_INTERFACE="${WG_INTERFACE:-wg0}"
export WG_CONF_PATH="${WG_CONF_PATH:-/etc/wireguard/${WG_INTERFACE}.conf}"
export DB_PATH="${DB_PATH:-/etc/wgctl/${WG_INTERFACE}.sqlite}"

KNOWN_SUBCOMMANDS="setup peer status join up down service uninstall update"

is_known_subcommand() {
  for c in $KNOWN_SUBCOMMANDS; do
    [ "$1" = "$c" ] && return 0
  done
  return 1
}

# Admin passthrough — anything that isn't the "hub" startup keyword and
# looks like a real wgctl invocation (a known subcommand, e.g. `join
# <token>`, or a bare flag like --help) runs directly instead of falling
# into the foreground startup flow below.
if [ "$#" -gt 0 ] && [ "$1" != "hub" ]; then
  if is_known_subcommand "$1" || [ "${1#-}" != "$1" ]; then
    exec $WGCTL "$@"
  fi
fi

down() {
  echo "Stopping ${WG_INTERFACE}..."
  $WGCTL down --interface "$WG_INTERFACE" || true
  exit 0
}
trap down TERM INT

if [ ! -f "$WG_CONF_PATH" ]; then
  if [ -n "${JOIN_TOKEN:-}" ]; then
    echo "No config at ${WG_CONF_PATH} — joining with JOIN_TOKEN..."
    $WGCTL join "$JOIN_TOKEN" --interface "$WG_INTERFACE"
  else
    echo "No config at ${WG_CONF_PATH} — running hub setup..."
    set -- $WGCTL setup --yes --interface "$WG_INTERFACE" \
      --port "${WG_LISTEN_PORT:-51820}" --subnet "${WG_SUBNET:-10.88.0.0/24}"
    [ -n "${PUBLIC_HOST:-}" ] && set -- "$@" --public-host "$PUBLIC_HOST"
    "$@"
  fi
else
  echo "Found existing config at ${WG_CONF_PATH} — bringing ${WG_INTERFACE} up..."
  $WGCTL up --interface "$WG_INTERFACE"
fi

echo "${WG_INTERFACE} is up. Tailing to keep the container alive (SIGTERM brings it down cleanly)."
sleep infinity &
wait $!
