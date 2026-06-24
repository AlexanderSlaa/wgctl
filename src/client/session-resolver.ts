import { loadSession, listSessionHosts, type SessionData } from "./config-store.js";

export function parseServerFlag(args: string[]): string | undefined {
  const i = args.indexOf("--server");
  return i !== -1 ? args[i + 1] : undefined;
}

/**
 * Resolves the session to use for a command, honoring an explicit
 * `--server <url>` flag if present. Prints a helpful error (and returns
 * undefined) if no session can be resolved — callers should just check for
 * undefined and return.
 */
export function resolveSession(args: string[]): SessionData | undefined {
  const serverUrl = parseServerFlag(args);
  const session = loadSession(serverUrl);
  if (session) return session;

  if (serverUrl) {
    console.error(`Not logged in to ${serverUrl}. Run \`wgctl login --server ${serverUrl}\` first.`);
    return undefined;
  }

  const hosts = listSessionHosts();
  if (hosts.length === 0) {
    console.error("Not logged in. Run `wgctl login` first.");
  } else {
    console.error(`Logged in to multiple servers (${hosts.join(", ")}) — specify which with --server <url>.`);
  }
  return undefined;
}
