# Repository Guidelines

## Project Structure & Module Organization

This repository builds `wgctl`, a Node 22 TypeScript CLI and HTTPS control-plane daemon for WireGuard. Source lives in `src/`. `src/main.ts` is the CLI entrypoint. Server code is under `src/server/`, with routes in `src/server/routes/`, SQLite repositories and `schema.sql` in `src/server/db/`, auth in `src/server/auth/`, and WireGuard orchestration in `src/server/wg/`. Client-side CLI helpers live in `src/client/`, shared pure utilities in `src/shared/`, and local admin commands in `src/commands/admin/`. Build output is generated in `dist/`; do not edit it by hand. Install and TLS helper scripts are in `scripts/`.

## Build, Test, and Development Commands

- `npm install`: install dependencies. In a source checkout this may build the native WireGuard addon; run `sudo bash scripts/install-native-deps.sh` first on a fresh Linux host.
- `npm test`: run the TypeScript typecheck with `tsc --noEmit`.
- `npm run build`: compile TypeScript, copy `src/server/db/schema.sql`, and make `dist/main.js` executable.
- `node dist/main.js serve`: run the built daemon locally after a successful build.
- `npm link && wgctl ...`: exercise the CLI as an installed binary during manual testing.

## Coding Style & Naming Conventions

Use TypeScript ES modules. Follow the existing style: two-space indentation, explicit imports, semicolons, and small functions with direct error handling. Keep server, client, shared, and admin boundaries clear. Use kebab-case filenames such as `api-client.ts` and `conf-parser.ts`; reserve PascalCase for classes such as `WgManager`.

## Testing Guidelines

There is no unit test suite yet; `npm test` is currently the required typecheck. For behavioral changes, add focused tests if introducing a test framework, or document manual verification steps in the PR. Good first test targets are pure modules such as `src/shared/cidr.ts`, `src/server/wg/conf-parser.ts`, and `src/server/wg/ip-pool.ts`.

## Commit & Pull Request Guidelines

Use Conventional Commits: `fix: ...`, `feat: ...`, `docs: ...`, `chore: ...`, or scoped forms like `feat(cli): ...`. Releases are handled by semantic-release, so do not manually bump `package.json`. PRs should include a clear summary, verification commands, linked issues when applicable, and notes for any changes touching WireGuard bootstrap, auth, TLS, systemd, or database schema behavior.

## Security & Configuration Tips

Treat auth, TLS fingerprints, private keys, sessions, and WireGuard config as sensitive. Do not commit secrets or local generated config. Be especially careful with `src/server/wg/bootstrap.ts`; it must remain idempotent and non-destructive because it can run on every daemon restart.
