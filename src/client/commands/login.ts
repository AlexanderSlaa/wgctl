import { askText, askPassword } from "../prompts.js";
import { login as apiLogin } from "../api-client.js";
import { saveSession } from "../config-store.js";

export async function loginCommand(args: string[]): Promise<void> {
  const serverFlagIndex = args.indexOf("--server");
  const serverUrl =
    serverFlagIndex !== -1 ? args[serverFlagIndex + 1] : process.env.WGCTL_SERVER ?? (await askText("Server URL (e.g. https://vpn.example.com:8443): "));

  const username = await askText("Username: ");
  const password = await askPassword("Password: ");

  const result = await apiLogin(serverUrl, { username, password });

  saveSession({
    serverUrl,
    token: result.token,
    username: result.username,
    certFingerprint: result.certFingerprint,
  });

  console.log(`Logged in as ${result.username}. Session valid until ${result.expiresAt}.`);
  console.log(`Trusted this server's TLS certificate (fingerprint ${result.certFingerprint}) for future requests.`);
}
