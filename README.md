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
sudo wgctl setup [--interface <name>] [--force]
```

The wizard asks for:
- WireGuard interface name (default `wg0`)
- UDP listen port (default 51820, or 51820+N for `wgN`)
- Tunnel subnet CIDR (default `10.88.0.0/24`)
- Public hostname or IP peers connect to (auto-detected from network interfaces)
- Systemd service mode: start now + autostart on boot, autostart only, start now only, or install unit only

It writes `/etc/wireguard/<iface>.conf` (with PostUp/PreDown forwarding rules
built in) and an env file at `/etc/wgctl/<iface>.env`. Use `--force` to
overwrite an existing configuration without prompting. If setup was already
run, the wizard detects this and offers to re-run or exit.

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
sudo wgctl service logs [-f] [-n N]
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
sudo wgctl peer ls              # list all peers with tunnel IPs, routes, and last handshake
sudo wgctl peer rm <id|label>   # remove a peer
sudo wgctl peer token <label>   # re-generate a join token for an existing peer
```

### Overlay routing

Every peer receives `AllowedIPs = <tunnel-subnet>` (e.g. `10.88.0.0/24`),
so peer A can reach peer B at `10.88.0.B` by routing through the hub. The
hub enables IP forwarding and an iptables FORWARD rule automatically.

### Exposing LAN subnets to the overlay

A peer can advertise subnets from its local network so other peers in the
overlay can reach them. Pass `--routes` when adding the peer on the hub:

```sh
sudo wgctl peer add office --routes 192.168.1.0/24 --join-token
```

Multiple subnets are comma-separated:

```sh
sudo wgctl peer add office --routes 192.168.1.0/24,10.0.0.0/8 --join-token
```

When the token is applied on the peer machine with `wgctl join`, wgctl
automatically:

1. Detects the default outbound interface (e.g. `eth0`)
2. Writes `PostUp`/`PostDown` iptables masquerade rules into the WireGuard
   config for that interface
3. Enables `net.ipv4.ip_forward` and persists it to
   `/etc/sysctl.d/99-wgctl-<iface>.conf`

Every join token generated after this point includes the advertised subnets
in its `AllowedIPs`, so any peer that joins later can reach the exposed LAN
automatically.

> **Note:** Tokens generated *before* the `--routes` peer was added will not
> include the new subnets. Regenerate them with `wgctl peer token <label>`
> and re-apply on those machines.

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
sudo wgctl join rm [-y]              # stops wg-quick@wg0 and removes the config
sudo wgctl join rm --interface wg1
```

For non-Linux peers (mobile, Windows, macOS), use the `.conf` export on the
hub and import it into the WireGuard app:

```sh
sudo wgctl peer add my-phone --output phone.conf
```

## Starting and stopping tunnels

Start or stop an existing tunnel without changing its configuration or
systemd autostart setting:

```sh
sudo wgctl up [--interface <name>]    # start a stopped tunnel (hub or peer)
sudo wgctl down [--interface <name>]  # stop a running tunnel, keep config
```

Both commands work on any wgctl-managed unit — the `wg-quick@<iface>` unit
used by joined peers or the legacy `wgctl-<iface>` hub unit.

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

## Docker / Kubernetes

wgctl normally manages the tunnel through a systemd unit (`wg-quick@<iface>`
or, on the hub, `wgctl service ...`). Containers don't have systemd, so
every command that would otherwise touch it — `setup`, `join`, `up`,
`down`, `service` — detects that (via `/run/systemd/system`) and drives
`wg-quick` directly instead. Nothing else about the CLI changes.

CI publishes an image on every release to `ghcr.io/alexanderslaa/wgctl`,
tagged with the release version and `latest` (a package GHCR creates as
private the first time it's pushed — flip it to public in the repo's
Packages settings if it should be pullable without auth):

```sh
docker pull ghcr.io/alexanderslaa/wgctl:latest
```

Or build it yourself from the `Dockerfile` in this repo:

```sh
docker build -t wgctl:latest .
```

The image's entrypoint has two modes:

- **Admin passthrough** — `docker run wgctl:latest peer add alice --join-token`
  (or `kubectl exec <pod> -- wgctl peer ls`) runs that subcommand and exits,
  same as running it on a host.
- **Default (`CMD ["hub"]`)** — on first start, runs `wgctl join` if
  `JOIN_TOKEN` is set, otherwise `wgctl setup --yes` using `WG_INTERFACE` /
  `WG_LISTEN_PORT` / `WG_SUBNET` / `PUBLIC_HOST` env vars; on later starts
  (config already present, e.g. on a mounted volume) it just brings the
  interface up. Either way it then stays in the foreground and brings the
  interface down cleanly on `SIGTERM`.

Run a hub:

```sh
docker run -d --name wgctl-hub \
  --cap-add NET_ADMIN --cap-add NET_RAW \
  --sysctl net.ipv4.ip_forward=1 \
  -p 51820:51820/udp \
  -e PUBLIC_HOST=vpn.example.com \
  -v wgctl-wireguard:/etc/wireguard -v wgctl-data:/etc/wgctl \
  wgctl:latest
```

Run a peer that joins with a token. The token embeds the peer's private
key, so treat it like a secret: pass it via `--env-file` (a `chmod 600`
file, not committed) rather than `-e`, which leaks it into `docker inspect`
and your shell history:

```sh
echo "JOIN_TOKEN=wgctl-join-v1...." > wgctl-peer.env && chmod 600 wgctl-peer.env
docker run -d --name wgctl-peer \
  --cap-add NET_ADMIN --cap-add NET_RAW \
  --env-file wgctl-peer.env \
  -v wgctl-wireguard:/etc/wireguard \
  wgctl:latest
rm wgctl-peer.env
```

Requirements either way: the host/node kernel needs the WireGuard module
(most kernels ≥5.6 have it built in or loadable — this is not something the
container can provide), and the container needs `CAP_NET_ADMIN` +
`CAP_NET_RAW` plus a writable `net.ipv4.ip_forward` sysctl in its network
namespace (`--sysctl` on plain Docker; a pod-level `securityContext.sysctls`
entry on Kubernetes — only needed on the hub, which forwards traffic for
peers' advertised routes). Neither requires `--privileged`.

### Docker Compose

Example Compose files are in [`deploy/docker-compose/`](./deploy/docker-compose/).

`hub.yml` runs a standalone hub — set `PUBLIC_HOST`, then:

```sh
docker compose -f deploy/docker-compose/hub.yml up -d
docker compose -f deploy/docker-compose/hub.yml exec wgctl-hub wgctl peer add alice --join-token
```

`app-with-vpn.yml` is the sidecar pattern for an app that needs the VPN
(e.g. vLLM reaching a service that only lives on the overlay) — put a
generated `JOIN_TOKEN` in `wgctl-peer.env` (`chmod 600`, not committed)
next to it, then:

```sh
docker compose -f deploy/docker-compose/app-with-vpn.yml up -d
```

It uses `network_mode: "service:wgctl"` on the app container — Compose's
equivalent of Kubernetes' shared-Pod-netns, since Compose has no per-pod
network isolation of its own. Once wgctl brings `wg0` up, the app
container reaches the overlay directly with no proxying and no changes on
its side, at the cost that any port the app needs published has to go on
the `wgctl` service's `ports:` instead of its own (they share one network
stack, so only its owner can publish).

### Kubernetes

Example manifests are in [`deploy/k8s/`](./deploy/k8s/):
`hub.yaml` (a `StatefulSet` hub behind a `LoadBalancer` Service),
`peer.yaml` (a standalone Pod using the sidecar pattern below), and
`deployment-sidecar.yaml` (the same sidecar added to a Deployment — the
one to copy from for a real app). Read the comments at the top of each
file before applying — in particular, `PUBLIC_HOST` has a chicken-and-egg
dependency on the hub Service's external address.

### Adding the VPN sidecar to an existing Deployment

The common case (e.g. vLLM needing to reach a model/service that only
lives on the VPN): add wgctl as a sidecar in the *same Pod* as your app,
rather than running it as its own Deployment. Containers in a Pod share
one network namespace, so once the sidecar brings `wg0` up, the app
container reaches the overlay directly — no proxying, no client-side
networking changes, no extra Service.

1. **Generate a join token on the hub** (one per app instance is fine;
   tokens don't expire — see [Security considerations](#security-considerations)):
   ```sh
   kubectl exec -it wgctl-hub-0 -- wgctl peer add my-vllm-deploy --join-token
   ```

2. **Store it as a Secret** — never inline it in the Deployment YAML:
   ```sh
   kubectl create secret generic wgctl-peer-token --from-literal=JOIN_TOKEN='wgctl-join-v1....'
   ```

3. **Add the sidecar to your Deployment's pod template** (`spec.template.spec`):
   an `initContainers` entry for wgctl with `restartPolicy: Always` (this
   is what makes it a *native sidecar* — starts before, keeps running
   alongside, the app container), a `startupProbe` so the app container
   doesn't race the tunnel coming up, and a scratch volume for wgctl's
   config. The app container itself needs no changes — no capabilities,
   no volume mount, nothing:
   ```yaml
   spec:
     template:
       spec:
         initContainers:
           - name: wgctl
             image: your-registry/wgctl:latest
             restartPolicy: Always
             env:
               - name: WG_INTERFACE
                 value: wg0
               - name: JOIN_TOKEN
                 valueFrom:
                   secretKeyRef:
                     name: wgctl-peer-token
                     key: JOIN_TOKEN
             securityContext:
               capabilities:
                 add: ["NET_ADMIN", "NET_RAW"]
             volumeMounts:
               - name: wireguard-conf
                 mountPath: /etc/wireguard
             startupProbe:
               exec:
                 command: ["sh", "-c", "wg show \"$WG_INTERFACE\""]
               periodSeconds: 2
               failureThreshold: 30
         containers:
           - name: vllm # your existing app container, unchanged
             # ...
         volumes:
           - name: wireguard-conf
             emptyDir: {} # token embeds the private key, so this is safe to lose on reschedule
   ```
   The full, copy-pasteable version is [`deploy/k8s/deployment-sidecar.yaml`](./deploy/k8s/deployment-sidecar.yaml).

4. **Apply it**: `kubectl apply -f your-deployment.yaml`. Watch the
   sidecar come up with `kubectl logs <pod> -c wgctl`; once `startupProbe`
   passes the app container starts and can reach addresses on the
   overlay/advertised subnets.

Native sidecars (`restartPolicy: Always` on an `initContainer`) need
Kubernetes 1.29+. On older clusters, put the wgctl container in
`containers:` instead and drop `restartPolicy` / `startupProbe` — it'll
still work, but container start order within a Pod isn't guaranteed, so
the app should retry its VPN-side connections rather than assume the
tunnel is already up.

Scope what the app can reach: generate the join token with
`wgctl peer add ... --routes <cidr,...>` on the hub so `AllowedIPs` covers
only the overlay/advertised subnets the app actually needs, not
`0.0.0.0/0` — otherwise all of the app container's traffic gets pulled
through the tunnel.

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
sudo wgctl uninstall                   # stops services, removes unit/env files
sudo wgctl uninstall --purge-data      # also removes SQLite DB, WireGuard conf, sysctl files
sudo wgctl uninstall --client-config   # also removes ~/.config/wgctl client sessions/keys
sudo wgctl uninstall --npm             # also runs npm uninstall -g wgctl
```

Flags can be combined. Use `-y` to skip confirmation prompts.

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
