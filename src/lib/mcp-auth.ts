import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { WS } from "./workspace";
import { auth as runAuth, UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientProvider, OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

/**
 * One-click MCP sign-in: OAuth 2.1 with dynamic client registration and PKCE, so a remote server
 * connects without the user creating an app or copying an API key. Tokens are stored per server in
 * the workspace (system/mcp/auth.json, owner-only) and never leave the machine.
 *
 * The flow: the app opens the authorization URL the server hands us → the browser comes back to
 * /api/mcp/oauth/callback with a code → finishOAuth exchanges it. A code can also be pasted by hand
 * when the browser cannot reach the app (remote or hosted install).
 */
type Stored = {
  tokens?: OAuthTokens;
  client?: OAuthClientInformationMixed;
  discovery?: OAuthDiscoveryState;
  verifier?: string;
  state?: string;
  /** authorization URL waiting for the user to finish; the panel shows it until the callback lands */
  pending?: string;
  redirect?: string;
  error?: string;
  at?: string;
};

const authPath = () => path.join(WS, "system", "mcp", "auth.json");

export async function readAuth(): Promise<Record<string, Stored>> {
  try { return JSON.parse(await fs.readFile(authPath(), "utf8")) || {}; } catch { return {}; }
}
async function writeAuth(all: Record<string, Stored>) {
  await fs.mkdir(path.dirname(authPath()), { recursive: true });
  await fs.writeFile(authPath(), JSON.stringify(all, null, 2) + "\n", { mode: 0o600 });
}
async function patch(name: string, p: Partial<Stored>) {
  const all = await readAuth();
  all[name] = { ...all[name], ...p, at: new Date().toISOString() };
  await writeAuth(all);
}

/** The state we generated for this server (used to match the OAuth callback). */
export async function stateFor(name: string) { return (await readAuth())[name]?.state; }
export const serverByName = (servers: Record<string, OAuthServerCfg>, name: string) => servers[name];

/** Connected = we hold tokens for this server. Never exposes the tokens themselves. */
export async function authStatus(): Promise<Record<string, { connected: boolean; pending: boolean; redirect?: string; error?: string }>> {
  const all = await readAuth();
  return Object.fromEntries(Object.entries(all).map(([k, v]) => [k, { connected: !!v.tokens?.access_token, pending: !!v.pending && !v.tokens, ...(v.redirect ? { redirect: v.redirect } : {}), ...(v.error ? { error: v.error } : {}) }]));
}
export async function forgetTokens(name: string) {
  const all = await readAuth();
  delete all[name];
  await writeAuth(all);
}

export const APP_NAME = "Local AI Workspace";

/** OAuthClientProvider backed by the workspace file, so every route and the agent share one session. */
class FileOAuth implements OAuthClientProvider {
  constructor(private name: string, private redirect: string, private preRegistered?: { client_id: string; client_secret?: string }) {}
  get redirectUrl() { return this.redirect; }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: APP_NAME,
      redirect_uris: [this.redirect],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: this.preRegistered?.client_secret ? "client_secret_post" : "none",
    };
  }
  private async get() { return (await readAuth())[this.name] || {}; }
  async clientInformation() {
    if (this.preRegistered) return { client_id: this.preRegistered.client_id, ...(this.preRegistered.client_secret ? { client_secret: this.preRegistered.client_secret } : {}), redirect_uris: [this.redirect] } as OAuthClientInformationMixed;
    return (await this.get()).client;
  }
  async saveClientInformation(client: OAuthClientInformationMixed) { await patch(this.name, { client }); }
  async tokens() { return (await this.get()).tokens; }
  async saveTokens(tokens: OAuthTokens) { await patch(this.name, { tokens, pending: undefined, error: undefined }); }
  async saveCodeVerifier(verifier: string) { await patch(this.name, { verifier }); }
  async codeVerifier() { const v = (await this.get()).verifier; if (!v) throw new Error("OAuth session lost its code verifier; start the sign-in again."); return v; }
  async saveDiscoveryState(state: OAuthDiscoveryState) { await patch(this.name, { discovery: state }); }
  async discoveryState() { return (await this.get()).discovery; }
  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    if (scope === "all") return void (await forgetTokens(this.name));
    await patch(this.name, scope === "tokens" ? { tokens: undefined } : scope === "client" ? { client: undefined } : scope === "discovery" ? { discovery: undefined } : { verifier: undefined });
  }
  async state() {
    const s = (await this.get()).state;
    if (s) return s;
    const fresh = crypto.randomUUID();
    await patch(this.name, { state: fresh });
    return fresh;
  }
  /** The SDK hands us the URL it built (after discovery + dynamic registration); the panel shows it. */
  async redirectToAuthorization(url: URL) { await patch(this.name, { pending: url.toString() }); }
}

export type OAuthServerCfg = { url?: string; clientId?: string; clientSecret?: string };

const providerFor = (name: string, redirect: string, cfg: OAuthServerCfg) =>
  new FileOAuth(name, redirect, cfg.clientId ? { client_id: cfg.clientId, client_secret: cfg.clientSecret } : undefined);

/** Provider for the agent side: an already-connected server just reuses its stored token (refreshing as needed). */
export async function providerForServer(name: string, cfg: OAuthServerCfg) {
  const stored = (await readAuth())[name];
  return providerFor(name, stored?.redirect || "http://127.0.0.1:3000/api/mcp/oauth/callback", cfg);
}

export const redirectUri = (origin: string) => `${origin.replace(/\/$/, "")}/api/mcp/oauth/callback`;

/**
 * Ask the server to authorize. Returns the URL the user must open (the SDK discovers the authorization
 * server and registers this app dynamically on the way). Rejects with the server's own error otherwise.
 */
export async function startOAuth(name: string, cfg: OAuthServerCfg, origin: string): Promise<{ url?: string; connected?: boolean }> {
  if (!cfg.url) throw new Error(`${name} is not a remote (URL) MCP server.`);
  const redirect = redirectUri(origin);
  await patch(name, { redirect, state: undefined, error: undefined, pending: undefined });
  const provider = providerFor(name, redirect, cfg);
  try {
    await runAuth(provider, { serverUrl: new URL(cfg.url) });
    return { connected: true }; // tokens were already valid
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      const url = (await readAuth())[name]?.pending;
      if (url) return { url };
      throw new Error("The server asked for authorization but did not provide an authorization URL.");
    }
    await patch(name, { error: String((e as Error).message || e) });
    throw e;
  }
}

/** Exchange the code from the callback (or pasted by the user) for tokens. */
export async function finishOAuth(name: string, cfg: OAuthServerCfg, code: string, origin?: string) {
  if (!cfg.url) throw new Error(`${name} is not a remote (URL) MCP server.`);
  const stored = (await readAuth())[name] || {};
  const redirect = origin ? redirectUri(origin) : stored.redirect;
  if (!redirect) throw new Error("Sign-in was not started from this app; restart it from Extensions.");
  const provider = providerFor(name, redirect, cfg);
  await runAuth(provider, { serverUrl: new URL(cfg.url), authorizationCode: code });
  await patch(name, { pending: undefined, error: undefined });
}

export async function authError(name: string, message: string) { await patch(name, { error: message, pending: undefined }); }
