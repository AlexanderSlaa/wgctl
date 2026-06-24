# wgctl

A single binary that's both the WireGuard orchestration server and the
terminal client. Run `wgctl serve` on the box that should act as the VPN
hub; run `wgctl login` / `wgctl connect` on any machine that wants to join.
Users authenticate with a username/password, pick which predefined networks
they're authorized to connect to, optionally advertise local subnets behind
their own machine, and the config exchange + tunnel setup on both ends
happens automatically over HTTPS — no hand-written WireGuard config files.

## Install

```sh
npm install -g wgctl
```

Requires Node.js 22+ and Linux (the native WireGuard control library talks
directly to the kernel via netlink — no `wg`/`wg-quick` binary needed).
`wgctl serve`, `connect`, `status`, and `down` need root / `CAP_NET_ADMIN`.

Every command (except `serve`, which doesn't want to hit npm on every
restart) checks once a day whether a newer version is on npm and prints a
one-line notice if so — it never blocks or delays the command's own output.
Run `wgctl update` (or `sudo wgctl update` if needed for permissions) to
install the latest version — it asks for confirmation first (`-y` to skip).

Installing the new files never by itself interrupts a running `wgctl serve`
or any existing WireGuard tunnel — the kernel keeps `wg0` and its peers up
independently of the wgctl process. The update only takes effect once you
restart the service (`sudo systemctl restart wgctl`), and that restart briefly
drops the HTTPS control-plane API for a few seconds (so a login/connect/
registration in progress at that exact moment would need to retry) —
existing tunnels are unaffected throughout, since the server's bootstrap
reuses `wg0` rather than recreating it when the key already matches.

## Running the server

```sh
sudo PUBLIC_HOST=<this server's public IP or hostname> wgctl serve
```

On first run this:
- generates a self-signed TLS certificate at `/etc/wgctl/tls/` if one doesn't exist,
- creates `/etc/wgctl/db.sqlite` (users, networks, peers) if it doesn't exist,
- **takes over the existing WireGuard interface on `wg0`/port 51820** if one
  is already configured by hand (e.g. via `wg-quick`): it reuses the existing
  private key and re-asserts any peers found in `/etc/wireguard/wg0.conf` as
  permanent "static" peers the API can never delete or modify, then manages
  additional peers registered through the API alongside them.

`PUBLIC_HOST` is optional — if unset, `wgctl` auto-detects the first
non-internal IPv4 address and warns about it. Set it explicitly if this box
has multiple interfaces, sits behind NAT, or clients should use a hostname.

### Running as a systemd service (so it survives a reboot)

WireGuard interfaces created via netlink only exist in the kernel — they
disappear on reboot until something runs `wgctl serve` again. `wgctl
service` manages a systemd unit that does that automatically:

```sh
sudo wgctl service enable     # installs the unit if needed, starts it now and on every boot
sudo wgctl service status
sudo wgctl service logs -f    # journalctl -u wgctl, follow mode
sudo wgctl service disable    # stop and remove from boot (unit file is kept)
sudo wgctl service uninstall  # stop, disable, and delete the unit + env file — asks to confirm (-y to skip)
```

Environment variables (`PUBLIC_HOST`, `PORT`, etc.) for the service go in
`/etc/wgctl/wgctl.env`, created by `wgctl service install`/`enable`.

### Managing users and networks

There's no web UI — manage everything from the same binary, run locally on
the server as root:

```sh
sudo wgctl user add alice <password>          # create a user
sudo wgctl user passwd alice                  # change a password
sudo wgctl user rm alice                      # remove a user (revokes their tunnel access too)
sudo wgctl user ls

sudo wgctl network add office-lan 192.168.10.0/24 "Office LAN"
sudo wgctl network grant alice office-lan     # authorize a user for a network
sudo wgctl network revoke alice office-lan
sudo wgctl network ls

sudo wgctl peer ls                            # every registered peer, with live handshake status
sudo wgctl peer rm <id>                       # revoke a single peer/device without removing its user
```

## Connecting as a client

```sh
wgctl login --server https://<host>:8443    # no root needed
wgctl networks                              # no root needed
sudo wgctl connect                          # configures the local tunnel — needs root/CAP_NET_ADMIN
sudo wgctl status
sudo wgctl down
```

You can be logged in to more than one server — `login` stores a separate
session per server. `networks`, `connect`, and `down` all accept
`--server <url>` to pick which one; with no flag they use whichever server
you most recently logged in to (or the only one, if there's just one).

The CLI pins the server's certificate fingerprint on first `login`
(trust-on-first-use) and verifies it on every later request, rather than
disabling TLS verification outright.

**Don't run `wgctl serve` and `wgctl connect` against each other on the same
machine/interface** — both default to managing an interface named `wg0`, so
running the client against a server on the same box will reconfigure (and
effectively replace the identity of) the very interface the server manages.

## Known limitations

- No NAT/internet-egress support — this mirrors a hand-configured
  hub-and-spoke setup, relaying peer-to-peer traffic through the server, not
  shared internet access.
- TLS is self-signed with CLI-side fingerprint pinning, not a CA-issued
  certificate.
- The masked-password prompt (`wgctl login`, `user passwd`) requires a real
  interactive terminal — it can't be driven through a plain non-interactive
  pipe.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for building from source, the
project layout, and the release process.
