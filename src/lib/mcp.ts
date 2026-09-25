import fs from "fs/promises";
import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { WS } from "./workspace";

export type ServerCfg = { command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string>; enabled?: boolean };
const CFG = () => path.join(WS, "system/mcp/servers.json");

export async function readServers(): Promise<Record<string, ServerCfg>> {
  try { return JSON.parse(await fs.readFile(CFG(), "utf8")).servers || {}; } catch { return {}; }
}
export async function writeServers(servers: Record<string, ServerCfg>) {
  await fs.mkdir(path.dirname(CFG()), { recursive: true });
  await fs.writeFile(CFG(), JSON.stringify({ servers }, null, 2));
  for (const k of Object.keys(pool)) { await pool[k].client.close().catch(() => {}); delete pool[k]; }
}

const expand = (s: string, vars: Record<string, string>) => s.replace(/\$\{(\w+)\}/g, (_, k) => vars[k] ?? process.env[k] ?? "");

type Conn = { client: Client; sig: string; tools: { name: string; description?: string; inputSchema: unknown }[] };
const g = globalThis as unknown as { __mcpPool?: Record<string, Conn> };
const pool: Record<string, Conn> = (g.__mcpPool ??= {});

async function connect(name: string, cfg: ServerCfg, vars: Record<string, string>): Promise<Conn> {
  const sig = JSON.stringify(cfg);
  if (pool[name]?.sig === sig) return pool[name];
  const client = new Client({ name: "workspace-agent", version: "1.0.0" });
  if (cfg.url) {
    const headers = Object.fromEntries(Object.entries(cfg.headers || {}).map(([k, v]) => [k, expand(v, vars)]));
    await client.connect(new StreamableHTTPClientTransport(new URL(expand(cfg.url, vars)), { requestInit: { headers } }));
  } else {
    const env = { ...(process.env as Record<string, string>), ...vars, ...Object.fromEntries(Object.entries(cfg.env || {}).map(([k, v]) => [k, expand(v, vars)])) };
    await client.connect(new StdioClientTransport({ command: cfg.command!, args: (cfg.args || []).map((a) => expand(a, vars)), env, cwd: WS, stderr: "ignore" }));
  }
  const { tools } = await client.listTools();
  return (pool[name] = { client, sig, tools: tools as Conn["tools"] });
}

export async function mcpTools(vars: Record<string, string>) {
  const servers = await readServers();
  const out: { server: string; name: string; description?: string; inputSchema: unknown }[] = [];
  const errors: string[] = [];
  await Promise.all(Object.entries(servers).filter(([, c]) => c.enabled).map(async ([name, cfg]) => {
    try {
      const c = await Promise.race([connect(name, cfg, vars), new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 25000))]);
      for (const t of c.tools) out.push({ server: name, ...t });
    } catch (e) { errors.push(`${name}: ${String(e).slice(0, 120)}`); }
  }));
  return { tools: out, errors };
}

export async function callMcp(server: string, tool: string, args: Record<string, unknown>) {
  const c = pool[server];
  if (!c) throw new Error("MCP server not connected: " + server);
  const r = await c.client.callTool({ name: tool, arguments: args });
  const content = (r.content as { type: string; text?: string }[]) || [];
  return content.map((x) => (x.type === "text" ? x.text : `[${x.type}]`)).join("\n");
}
