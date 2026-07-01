# Contributing to wgctl

This covers building from source, the project layout, and how releases work.
For installing and using the published package, see [README.md](./README.md).

## Building from source

```sh
git clone https://github.com/AlexanderSlaa/wgctl.git && cd wgctl
npm install
npm run build
node dist/main.js --help
```

No native addons. No runtime npm dependencies. Needs Node.js 22+ (uses the
built-in `node:sqlite` module) and `wireguard-tools` on Linux to actually
run any WireGuard commands.

```sh
npm test        # tsc --noEmit typecheck
npm run build   # tsc + copies schema.sql to dist/server/db/
```

## Project layout

```
src/
├── main.ts                   CLI entrypoint — arg dispatch, auto sudo-elevate
├── elevate.ts                re-exec self under sudo for root-required commands
├── version-check.ts          passive npm update-check shown after each command
├── shared/
│   ├── cidr.ts               CIDR math (parse, validate, hostAtOffset)
│   └── index.ts              re-exports
├── client/
│   └── prompts.ts            readline helpers: askText, askChoice
├── server/
│   ├── config.ts             reads /etc/wgctl/<iface>.env into a typed config object
│   ├── db/
│   │   ├── index.ts          opens the SQLite DB, runs schema.sql on first open
│   │   ├── peers.repo.ts     CRUD for the peers table
│   │   └── schema.sql        DB schema (peers + meta/token-hash tables)
│   └── wg/
│       ├── WgManager.ts      wraps `wg` CLI — upsert/remove live peers, parse `wg show dump`,
│       │                     append/remove peer stanzas in the .conf file
│       └── ip-pool.ts        allocates tunnel IPs from the hub subnet
└── commands/
    ├── join.ts               wgctl join / wgctl join rm
    ├── update.ts             wgctl update
    ├── updown.ts             wgctl up / wgctl down
    └── admin/
        ├── peer.ts           wgctl peer add / ls / rm / token
        ├── service.ts        wgctl service enable/disable/start/stop/restart/status/logs/uninstall
        ├── setup.ts          wgctl setup interactive wizard
        ├── status.ts         wgctl status
        └── uninstall.ts      wgctl uninstall
```

There is no HTTP server, no authentication layer, and no daemon process.
Every command runs as a short-lived CLI invocation that talks directly to
the `wg` and `wg-quick` binaries, systemd, and the SQLite database.

## Testing

No unit test suite yet beyond `npm test` (typecheck). Manual verification
has leaned on running against a real WireGuard interface. Good first
contributions: unit tests for `shared/cidr.ts`, `server/wg/ip-pool.ts`,
and the `renderConf`/`decodeToken` functions in the join/peer commands.

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

The CI workflow has two jobs: `test` (build + typecheck) on every push/PR,
and `release` (runs `semantic-release`) on pushes to `main` only, after
`test` passes. Publishing requires an `NPM_TOKEN` repository secret;
`GITHUB_TOKEN` is provided automatically by GitHub Actions.
