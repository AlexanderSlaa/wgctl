# Repository Guidelines

## Project Structure & Module Organization

This repository builds `wgctl`, a Node 22 TypeScript CLI for managing a
WireGuard hub-and-spoke overlay network. Source lives in `src/`.
`src/main.ts` is the CLI entrypoint. Hub-side logic (config, SQLite repos,
WireGuard management) lives in `src/server/`. Interactive readline prompts
are in `src/client/`. Pure utilities are in `src/shared/`. Commands are in
`src/commands/` (admin sub-commands under `src/commands/admin/`). Build
output is in `dist/`; do not edit it by hand. The install script is in
`scripts/`.

There is no HTTP server, no daemon process, no auth layer, and no TLS.
Every command is a short-lived CLI invocation that talks directly to the
`wg`/`wg-quick` binaries, systemd, and the SQLite database via the Node.js
built-in `node:sqlite` module. There are zero runtime npm dependencies.

## Build, Test, and Development Commands

- `npm install`: install dev dependencies (TypeScript + types only).
- `npm test`: typecheck with `tsc --noEmit`.
- `npm run build`: compile TypeScript, copy `src/server/db/schema.sql` to
  `dist/server/db/`, make `dist/main.js` executable.
- `node dist/main.js --help`: run the built CLI after a successful build.
- `npm link && wgctl ...`: exercise as an installed binary during manual testing.

## Coding Style & Naming Conventions

Use TypeScript ES modules. Two-space indentation, explicit imports,
semicolons, small functions with direct error handling. Keep `server/`,
`client/`, `shared/`, and `commands/` boundaries clear. Kebab-case
filenames (e.g. `ip-pool.ts`); PascalCase for classes (e.g. `WgManager`).

## Testing Guidelines

No unit test suite yet; `npm test` is the required typecheck. For
behavioral changes, add focused tests if introducing a test framework, or
document manual verification steps in the PR. Good first test targets are
pure modules: `src/shared/cidr.ts`, `src/server/wg/ip-pool.ts`, and the
`renderConf`/`decodeToken` functions in `src/commands/join.ts` and
`src/commands/admin/peer.ts`.

## Commit & Pull Request Guidelines

Use Conventional Commits: `fix: ...`, `feat: ...`, `docs: ...`, `chore: ...`,
or scoped forms like `feat(cli): ...`. Releases are handled by
semantic-release; do not manually bump `package.json`. PRs should include a
clear summary, verification commands, linked issues when applicable, and
notes for any changes touching WireGuard config generation, join-token
encoding, systemd integration, or database schema.

## Key Design Decisions

### Join token encoding
`wgctl peer add --join-token` encodes the full peer config (private key,
PSK, server public key, endpoint, `AllowedIPs`, `advertisedRoutes`) as a
base64url JSON blob prefixed with `wgctl-join-v1.`. Tokens are one-time-use
— a SHA-256 hash is stored in the peer's local SQLite DB on consumption.
`advertisedRoutes` (added in the routes feature) lists the subnets this
peer is advertising to others; it is separate from `AllowedIPs` (subnets
the client routes *to* the hub).

### Subnet advertisement (`--routes`)
`wgctl peer add --routes <cidr,...>` lets a peer expose LAN subnets to the
overlay. The hub stores routes in the `peers.routes` column (comma-separated
string). Server-side `AllowedIPs` for that peer = `tunnel_ip/32` + routes,
so the hub forwards traffic destined for those subnets to the peer. Every
newly generated join token includes all currently-advertised routes in its
`AllowedIPs`, so new peers can reach exposed LANs without manual config.

On `wgctl join`, if the token contains `advertisedRoutes`:
- The default outbound interface is detected via `ip route show default`
- `PostUp`/`PostDown` iptables masquerade rules are written into the
  WireGuard conf for that interface
- `net.ipv4.ip_forward` is enabled and persisted to
  `/etc/sysctl.d/99-wgctl-<iface>.conf`

### Database schema migrations
`src/server/db/index.ts` runs `schema.sql` on first open (`CREATE TABLE IF
NOT EXISTS`). Additive column migrations are handled by wrapping `ALTER
TABLE ... ADD COLUMN` in a try/catch — SQLite throws if the column already
exists, which is safe to ignore. Add new migrations in `getDb()` following
this pattern.

## Security & Configuration Tips

Treat WireGuard private keys, pre-shared keys, and join tokens as
sensitive. Do not commit secrets or generated config. Join tokens embed the
peer's private key as a base64 blob — any output or logging path that could
expose them needs careful review. The SQLite database at
`/etc/wgctl/<iface>.sqlite` contains peer public keys and PSKs; file
permissions matter.
