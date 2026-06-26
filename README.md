<div align="center">

# wgctl

[![npm version](https://img.shields.io/npm/v/wgctl?style=flat-square&color=f96743)](https://www.npmjs.com/package/wgctl)
[![npm downloads](https://img.shields.io/npm/dm/wgctl?style=flat-square)](https://www.npmjs.com/package/wgctl)
[![CI](https://img.shields.io/github/actions/workflow/status/AlexanderSlaa/wgctl/ci.yml?style=flat-square&label=CI)](https://github.com/AlexanderSlaa/wgctl/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/wgctl?style=flat-square)](./LICENSE)
[![node](https://img.shields.io/node/v/wgctl?style=flat-square&color=339933&logo=node.js&logoColor=white)](https://nodejs.org)

</div>

A CLI tool for running a WireGuard overlay network. One server acts as the
hub; any number of peers join it with a single command. All peers share a
flat tunnel subnet and can reach each other through the hub — no hand-written
WireGuard configs required.

**Requirements:** Node.js 22+, Linux, `wireguard-tools` (`wg` and `wg-quick`).

## Install

On a fresh Debian/Ubuntu server:

```sh
curl -fsSL https://raw.githubusercontent.com/AlexanderSlaa/wgctl/main/scripts/install.sh | sudo bash
```

This installs `wireguard-tools`, ensures Node.js 22 is available, installs
`wgctl` from npm, and starts `wgctl setup`. To install without running setup:

```sh
curl -fsSL https://raw.githubusercontent.com/AlexanderSlaa/wgctl/main/scripts/install.sh | sudo env RUN_SETUP=0 bash
```

Manual install:

```sh
npm install -g wgctl
apt-get install -y wireguard-tools iptables   # if not already installed
```

Commands that configure WireGuard (`peer`, `status`, `setup`)
require root / `CAP_NET_ADMIN`. If you run one without it, wgctl re-runs
itself under `sudo` automatically. Set `WGCTL_NO_SUDO=1` to disable this
and get a plain permission error instead.

## Hub server setup

Run this once on the machine that will act as the central hub:

```sh
sudo wgctl setup
```

The wizard asks for the WireGuard UDP port (default 51820), the tunnel
subnet (default `10.88.0.0/24`), the public IP/hostname peers will connect
to, and whether to enable the service now. It writes `/etc/wireguard/wg0.conf`
(with PostUp/PreDown forwarding rules built in) and enables `wg-quick@wg0`
via systemd so the interface comes back up automatically after a reboot.

### Running as a systemd service

`wgctl setup` installs and starts the service for you. You can also manage
it directly:

```sh
sudo wgctl service enable     # start now and on every boot
sudo wgctl service disable    # stop and remove from boot
sudo wgctl service start
sudo wgctl service stop
sudo wgctl service restart
sudo wgctl service status
sudo wgctl service logs -f
sudo wgctl service uninstall [-y]   # disable and remove env file
```

### Adding peers

Each peer gets a unique tunnel IP allocated from the hub's subnet. Run on
the hub:

```sh
sudo wgctl peer add <label> --join-token
```

This prints a one-liner to paste on the peer machine. The token is
one-time-use and contains everything the peer needs — no further
communication with the hub is required after joining.

To export a standard `.conf` file instead (for use with any WireGuard
client, including mobile apps):

```sh
sudo wgctl peer add <label> --output peer.conf
# or print to stdout:
sudo wgctl peer add <label>
```

Other peer management:

```sh
sudo wgctl peer ls              # list all peers with tunnel IPs and last handshake times
sudo wgctl peer rm <id|label>   # remove a peer
sudo wgctl peer token <label>   # re-generate a join token for an existing peer
```

### Overlay routing

Every peer receives `AllowedIPs = <tunnel-subnet>` (e.g. `10.88.0.0/24`),
so peer A can reach peer B at `10.88.0.B` by routing through the hub. The
hub enables IP forwarding and an iptables FORWARD rule automatically.

## Joining the overlay

On any Linux machine that should join the network, paste the token printed
by `wgctl peer add --join-token`:

```sh
sudo wgctl join 'wgctl-join-v1.<token>'
```

This writes `/etc/wireguard/wg0.conf` and enables `wg-quick@wg0` via
systemd so the tunnel comes back up automatically after a reboot.

To use a different interface name:

```sh
sudo wgctl join 'wgctl-join-v1.<token>' --interface wg1
```

To leave the overlay:

```sh
sudo wgctl join rm              # stops wg-quick@wg0 and removes the config
sudo wgctl join rm --interface wg1
```

For non-Linux peers (mobile, Windows, macOS), use the `.conf` export on the
hub and import it into the WireGuard app:

```sh
sudo wgctl peer add my-phone --output phone.conf
```

## Checking status

On the hub:

```sh
sudo wgctl status
```

On a joined peer, use standard WireGuard tools:

```sh
sudo wg show wg0
systemctl status wg-quick@wg0
```

## Updating

```sh
sudo wgctl update    # checks npm for a newer version, asks for confirmation (-y to skip)
```

Installing a new version does not interrupt running tunnels — the kernel
keeps WireGuard interfaces and peers up independently of the wgctl process.
The update takes effect once you restart the service:

```sh
sudo wgctl service restart
```

## Uninstalling

```sh
sudo wgctl uninstall              # stops services, removes unit/env files
sudo wgctl uninstall --purge-data # also removes the SQLite DB and WireGuard conf
sudo wgctl uninstall --npm        # also runs npm uninstall -g wgctl
```

## Security considerations

- **Share join tokens over secure channels.** Each token contains the peer's WireGuard private key as a base64 blob. Anyone who sees the token before it is used can impersonate that peer. Use SSH, an encrypted messenger, or similar — not plain email or chat.

- **Tokens do not expire.** A generated but unused token stays valid indefinitely. If you generate one and no longer need it, remove the peer with `wgctl peer rm <label>` to invalidate it.

- **IP forwarding is enabled globally.** The `PostUp` rule in `wg0.conf` runs `sysctl -w net.ipv4.ip_forward=1`, which enables packet forwarding for all interfaces on the host, not just `wg0`. The iptables `FORWARD` rule is scoped to the WireGuard interface only, so other traffic is still subject to your existing iptables policy.

- **The SQLite database is world-readable by default.** `/etc/wgctl/<iface>.sqlite` contains peer public keys and pre-shared keys. Restrict its permissions after setup:
  ```sh
  chmod 600 /etc/wgctl/wg0.sqlite
  ```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for building from source, the
project layout, and the release process.
