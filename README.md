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

## Running the server

```sh
sudo PUBLIC_HOST=<this server's public IP or hostname> wgctl serve
```

On first run this:
- generates a self-signed TLS certificate at `/etc/wgctl/tls/` if one doesn't exist,
- creates `/etc/wgctl/db.sqlite` (users, networks, peers) if it doesn't exist,
- **takes over the existing WireGuard interface on `wg0`/port 51820** if one
  is already configured by hand (e.g. via `wg-quick` — see
  `src/server/wg/bootstrap.ts`): it reuses the existing private key and
  re-asserts any peers found in `/etc/wireguard/wg0.conf` as permanent
  "static" peers the API can never delete or modify, then manages additional
  peers registered through the API alongside them.

`PUBLIC_HOST` is optional — if unset, `wgctl` auto-detects the first
non-internal IPv4 address and warns about it. Set it explicitly if this box
has multiple interfaces, sits behind NAT, or clients should use a hostname.

### Running as a systemd service (so it survives a reboot)

`@sourceregistry/node-wireguard` only talks to live kernel netlink state —
it writes nothing to disk, so `wg0` and everything on it disappear on
reboot until something runs `wgctl serve` again. `wgctl service` manages a
systemd unit that does that automatically:

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

## Known v1 gaps

- No NAT/internet-egress support — this mirrors a hand-configured
  hub-and-spoke setup, relaying peer-to-peer traffic through the server, not
  shared internet access.
- TLS is self-signed with CLI-side fingerprint pinning, not a CA-issued
  certificate.
- The masked-password prompt (`wgctl login`, `user passwd`) requires a real
  interactive terminal — it can't be driven through a plain non-interactive
  pipe.

## Development

```sh
git clone https://github.com/AlexanderSlaa/wgctl.git && cd wgctl
npm install
npm run build
node dist/main.js serve   # or: npm link && wgctl serve
```

## Releases

Versioning and npm publishing are automated with [semantic-release](https://semantic-release.gitbook.io/),
driven by [Conventional Commits](https://www.conventionalcommits.org/) on
`main` (`fix:`, `feat:`, `feat!:`/`BREAKING CHANGE:`, etc. — see
`.github/workflows/ci.yml` and `.releaserc.json`). Don't bump the version in
`package.json` by hand; commit message prefixes determine the next version.
