import { db, schemaReady } from "@/db";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";

export type Settings = {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  contextTokens: number;
  firecrawlUrl: string;
  firecrawlKey: string;
  firecrawlCloudUrl: string;
  /** Files the agent may touch. sandbox = workspace only; home = workspace + $HOME; full = whole disk. */
  access: Access;
  /** Where shell/python run. sandbox = isolated (bubblewrap if installed), cwd workspace; host = your real terminal. */
  terminal: "sandbox" | "host";
  /** Allow sudo/su/doas in host terminal. Uses SUDO_PASSWORD secret via `sudo -S` if set, else `sudo -n`. */
  sudo: boolean;
  secrets: Record<string, string>;
};
export type Access = "sandbox" | "home" | "full";

export const PRESETS: Record<string, { baseUrl: string; model: string; contextTokens?: number }> = {
  freellmapi: { baseUrl: "http://localhost:3001/v1", model: "gemini-2.5-flash", contextTokens: 1048576 },
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.5-flash-lite", contextTokens: 1048576 },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", contextTokens: 128000 },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", model: "google/gemini-2.5-flash-lite", contextTokens: 1048576 },
  ollama: { baseUrl: "http://localhost:11434/v1", model: "qwen2.5:7b", contextTokens: 32000 },
  custom: { baseUrl: "", model: "", contextTokens: 32000 },
};

export function defaults(): Settings {
  return {
    provider: (process.env.LLM_PROVIDER as string) || "freellmapi",
    baseUrl: process.env.LLM_BASE_URL || PRESETS.freellmapi.baseUrl,
    apiKey: process.env.LLM_API_KEY || "",
    model: process.env.LLM_MODEL || PRESETS.freellmapi.model,
    contextTokens: Number(process.env.LLM_CONTEXT_TOKENS) || 131072,
    firecrawlUrl: process.env.FIRECRAWL_URL || "http://localhost:3002",
    firecrawlKey: process.env.FIRECRAWL_API_KEY || "",
    firecrawlCloudUrl: process.env.FIRECRAWL_CLOUD_URL || "https://api.firecrawl.dev",
    access: (process.env.ACCESS_MODE as Access) || "sandbox",
    terminal: (process.env.TERMINAL_MODE as "host") || "sandbox",
    sudo: process.env.ALLOW_SUDO === "1",
    secrets: {},
  };
}

/** Operator ceiling: HOST_ACCESS=off (hosted/web deployments) pins files+terminal to the sandbox regardless of UI toggles. */
export const hostLocked = () => /^(0|off|false|no)$/i.test(process.env.HOST_ACCESS || "");

/** Validate + clamp access fields so neither stored rows nor API calls can exceed what this install allows. */
export function clampAccess(s: Settings): Settings {
  if (!["sandbox", "home", "full"].includes(s.access)) s.access = "sandbox";
  if (s.terminal !== "host") s.terminal = "sandbox";
  s.sudo = s.sudo === true && s.terminal === "host";
  if (hostLocked()) { s.access = "sandbox"; s.terminal = "sandbox"; s.sudo = false; }
  return s;
}

export async function getSettings(): Promise<Settings> {
  await schemaReady();
  const row = await db.select().from(settings).where(eq(settings.key, "app")).limit(1);
  return clampAccess({ ...defaults(), ...((row[0]?.value as Partial<Settings>) || {}) });
}

export async function saveSettings(patch: Partial<Settings>) {
  const cur = await getSettings();
  const next = clampAccess({ ...cur, ...patch });
  await db.insert(settings).values({ key: "app", value: next }).onConflictDoUpdate({ target: settings.key, set: { value: next } });
  return next;
}

export const mask = (s: Settings) => ({
  ...s,
  apiKey: s.apiKey ? "••••" + s.apiKey.slice(-4) : "",
  firecrawlKey: s.firecrawlKey ? "••••" + s.firecrawlKey.slice(-4) : "",
  secrets: Object.fromEntries(Object.keys(s.secrets || {}).map((k) => [k, "••••"])),
});
