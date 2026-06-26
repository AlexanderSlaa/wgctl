import { askText, askPassword } from "../prompts.js";
import { login as apiLogin } from "../api-client.js";
import { probeCertFingerprint } from "../https-client.js";
import { saveSession } from "../config-store.js";

export async function loginCommand(args: string[]): Promise<void> {
  const serverFlagIndex = args.indexOf("--server");
  const serverUrl =
    serverFlagIndex !== -1
      ? args[serverFlagIndex + 1]
      : process.env.WGCTL_SERVER ?? (await askText("Server URL (e.g. https://vpn.example.com:8443): "));

  // Parse --fingerprint: the expected SHA-256 fingerprint obtained out-of-band
  // (e.g. copied from `wgctl setup` output on the server).
  const fpFlagIdx = args.findIndex((a) => a === "--fingerprint");
  const trustedFingerprint = fpFlagIdx !== -1 ? args[fpFlagIdx + 1] : undefined;

  const tokenFlagIndex = args.findIndex((arg) => arg === "--setup-token" || arg === "--token");
  const tokenFlagValue = tokenFlagIndex !== -1 ? args[tokenFlagIndex + 1] : undefined;
  const usingSetupToken =
    process.env.WGCTL_SETUP_TOKEN != null ||
    tokenFlagIndex !== -1;

  // Step 1: Probe the server's certificate without sending any secrets.
  // This captures the fingerprint before credentials ever leave the client.
  const serverFingerprint = await probeCertFingerprint(serverUrl);

  // Step 2: Verify the fingerprint before proceeding.
  if (trustedFingerprint) {
    if (serverFingerprint !== trustedFingerprint) {
      console.error(
        `TLS certificate fingerprint mismatch — refusing to log in.\n` +
          `  Expected: ${trustedFingerprint}\n` +
          `  Got:      ${serverFingerprint}\n\n` +
          `If the server's certificate was legitimately regenerated, re-run setup and use the new fingerprint.`,
      );
      process.exitCode = 1;
      return;
    }
  } else {
    console.log(`\nServer TLS certificate fingerprint:\n  ${serverFingerprint}\n`);
    const trust = await askText("Trust this certificate and continue? [y/N]: ");
    if (trust.trim().toLowerCase() !== "y") {
      console.log("Login cancelled.");
      return;
    }
  }

  // Step 3: Collect credentials (after cert is verified — nothing is sent yet).
  let loginBody: { setupToken: string } | { username: string; password: string };
  if (usingSetupToken) {
    const setupToken =
      process.env.WGCTL_SETUP_TOKEN ??
      (tokenFlagValue && !tokenFlagValue.startsWith("--") ? tokenFlagValue : undefined) ??
      (await askPassword("Setup token: "));
    loginBody = { setupToken };
  } else {
    loginBody = {
      username: await askText("Username: "),
      password: await askPassword("Password: "),
    };
  }

  // Step 4: Send credentials with the cert pinned — MITM is no longer possible.
  const result = await apiLogin(serverUrl, loginBody, serverFingerprint);

  saveSession({
    serverUrl,
    token: result.token,
    username: result.username,
    certFingerprint: serverFingerprint,
  });

  console.log(`Logged in as ${result.username}. Session valid until ${result.expiresAt}.`);
  if (!trustedFingerprint) {
    console.log(`Certificate fingerprint ${serverFingerprint} pinned for future requests.`);
  }
}
