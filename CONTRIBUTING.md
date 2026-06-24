# Contributing to wgctl

This covers building from source, the project layout, and how releases work.
For installing and using the published package, see [README.md](./README.md).

## Building from source

```sh
git clone https://github.com/AlexanderSlaa/wgctl.git && cd wgctl
sudo bash scripts/install-native-deps.sh   # build toolchain for the native WireGuard addon
npm install
npm run build
node dist/main.js serve   # or: npm link && wgctl serve
```

`@sourceregistry/node-wireguard`'s `binding.gyp` makes `npm install` always
attempt a native build (`node-gyp rebuild`) regardless of whether a prebuild
matches your platform/Node ABI, so `scripts/install-native-deps.sh`
(`build-essential`, `pkg-config`, `libmnl-dev`, `libsodium-dev`) needs to run
first or `npm install` will fail.

```sh
npm test    # currently just `tsc --noEmit` — there are no unit tests yet (see below)
npm run build
```

## Project layout

```
src/
├── main.ts                  CLI entrypoint — dispatches to everything below
├── version-check.ts          npm update-check/notice logic
├── shared/                  pure helpers used by both server and client (CIDR math, iptables/sysctl)
├── server/                  the daemon (`wgctl serve`)
│   ├── app.ts                 HTTPS app + middleware (node-webserver)
│   ├── routes/                 /api/auth, /api/networks, /api/peers
│   ├── db/                    SQLite schema + repos (users, networks, peers)
│   ├── auth/                   session tokens, password hashing
│   └── wg/
│       ├── bootstrap.ts         the wg0-takeover sequence — run this past someone before changing it
│       ├── WgManager.ts          wraps the single shared WireGuardClient instance
│       └── conf-parser.ts       parses the pre-existing /etc/wireguard/wg0.conf during takeover
├── client/                  the terminal client (`login`/`networks`/`connect`/`status`/`down`)
│   ├── api-client.ts            talks to the server's HTTP API
│   ├── https-client.ts          TLS fingerprint pinning (trust-on-first-use)
│   └── config-store.ts          ~/.config/wgctl/ (per-server sessions, keypairs)
└── commands/admin/          server-local admin commands (user/network/peer/service) — operate
                              directly on the SQLite DB and WgManager, no HTTP involved
```

A few things worth knowing before changing `wg/bootstrap.ts` specifically:
it's responsible for taking over a pre-existing, hand-configured `wg0`
interface (reusing its private key, re-asserting its peers as "static") and
must stay idempotent/non-destructive — it runs on every `wgctl serve` start,
including every systemd restart. The kernel-side `AllowedIPs` pushed for a
peer (its own tunnel IP + advertised subnets) and the client-side
`AllowedIPs` returned over the API (the networks it's authorized for) are
deliberately different lists for the same connection — see the comment in
`WgManager.ts` if this trips you up.

## Testing

There's no real test suite yet beyond a typecheck (`npm test`) — this is the
biggest gap if you want to contribute. Manual verification so far has
leaned on running the actual binary against a real WireGuard interface
(see git history for examples of staged, non-destructive verification
against a live `wg0`). Unit tests for the pure modules (`shared/cidr.ts`,
the conf parser, the IP pool allocator) would be a good first contribution.

## Commit messages and releases

Versioning and npm publishing are automated with
[semantic-release](https://semantic-release.gitbook.io/), driven by
[Conventional Commits](https://www.conventionalcommits.org/) on `main` (see
`.github/workflows/ci.yml` and `.releaserc.json`):

- `fix: ...` → patch release
- `feat: ...` → minor release
- `feat!: ...` or a `BREAKING CHANGE:` footer → major release
- Other prefixes (`docs:`, `chore:`, `refactor:`, `ci:`, etc.) don't trigger a release

Don't bump the version in `package.json` by hand — `semantic-release`
computes the next version from commit messages and updates it, the
changelog, and the git tag automatically on every push to `main`.

The CI workflow has two jobs: `test` (build + typecheck + a smoke test that
actually runs the built binary) on every push/PR, and `release` (runs
`semantic-release`) on pushes to `main` only, after `test` passes. Publishing
requires an `NPM_TOKEN` repository secret; `GITHUB_TOKEN` is provided
automatically by GitHub Actions.
