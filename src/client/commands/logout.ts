import { logout as apiLogout } from "../api-client.js";
import { loadSession, removeSession } from "../config-store.js";

export async function logoutCommand(args: string[]): Promise<void> {
  const serverFlagIndex = args.indexOf("--server");
  const serverUrl = serverFlagIndex !== -1 ? args[serverFlagIndex + 1] : undefined;

  const session = loadSession(serverUrl);
  if (!session) {
    console.log(serverUrl ? `Not logged in to ${serverUrl}.` : "Not logged in.");
    return;
  }

  try {
    await apiLogout(session.serverUrl, session.token, session.certFingerprint);
  } catch {
    // Best-effort: revoke locally even if the server is unreachable or the token is already expired.
  }

  removeSession(session.serverUrl);
  console.log(`Logged out from ${session.serverUrl}.`);
}
