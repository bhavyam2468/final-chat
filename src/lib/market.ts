import type { ServerCfg } from "./mcp";

/**
 * Curated extensions. Rule: nothing that duplicates a built-in tool (files, fetch/scrape, browser, shell,
 * python, memory); those are listed in BUILTIN so the UI can say why they are absent. Credentials are
 * ${VARS}: resolved from Settings secrets → environment → native CLI logins (see credentials.ts).
 */
export type Cred = { name: string; label: string; help?: string; optional?: boolean };
export type McpEntry = {
  id: string; title: string; description: string; config: ServerCfg; creds: Cred[]; needs?: string;
  /** One-click: the server signs in with OAuth 2.1 + dynamic client registration, so the user copies no key. */
  oauth?: boolean;
  /** The provider requires a pre-registered app: the user needs a client id (and usually a secret). */
  prereg?: boolean;
  featured?: boolean;
};
export type SkillRepo = { source: string; title: string; description: string };

/**
 * Curated extensions. Two rules:
 * 1. Nothing that duplicates a built-in tool (files, fetch/scrape, browser, shell, python, memory) — those live in BUILTIN.
 * 2. Remote servers marked `oauth` connect with one click and no API key (discovery + dynamic client registration).
 *    Anything else is either keyless, or honest about the credential it needs. ${VARS} resolve from Settings
 *    secrets → environment → native CLI logins (see credentials.ts).
 */
export const MCP_CATALOG: McpEntry[] = [
  {
    id: "notion", title: "Notion", description: "Search your workspace, read and write pages, databases and comments.", oauth: true, featured: true,
    config: { url: "https://mcp.notion.com/mcp" }, creds: [],
  },
  {
    id: "linear", title: "Linear", description: "Issues, projects, cycles and teams.", oauth: true, featured: true,
    config: { url: "https://mcp.linear.app/mcp" }, creds: [],
  },
  {
    id: "atlassian", title: "Jira & Confluence", description: "Atlassian Cloud: issues, pages, search (Rovo MCP server).", oauth: true, featured: true,
    config: { url: "https://mcp.atlassian.com/v1/mcp" }, creds: [],
  },
  {
    id: "figma", title: "Figma", description: "Design files, components, comments and FigJam boards.", oauth: true,
    config: { url: "https://mcp.figma.com/mcp" }, creds: [],
  },
  {
    id: "sentry", title: "Sentry", description: "Errors, issues, releases and performance traces.", oauth: true,
    config: { url: "https://mcp.sentry.dev/mcp" }, creds: [],
  },
  {
    id: "deepwiki", title: "DeepWiki", description: "Ask questions about any public GitHub repository. No account needed.", featured: true,
    config: { url: "https://mcp.deepwiki.com/mcp" }, creds: [],
  },
  {
    id: "context7", title: "Context7", description: "Current, version-specific library documentation and code examples. Works without a key.", featured: true,
    config: { url: "https://mcp.context7.com/mcp" },
    creds: [{ name: "CONTEXT7_API_KEY", label: "API key (optional, higher limits)", help: "https://context7.com/dashboard", optional: true }],
  },
  {
    id: "github", title: "GitHub", description: "Repositories, issues, pull requests, code search, Actions (GitHub's own remote server).", featured: true,
    config: { url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "Bearer ${GITHUB_TOKEN}" } },
    creds: [{ name: "GITHUB_TOKEN", label: "Personal access token", help: "https://github.com/settings/personal-access-tokens · or sign in with `gh auth login` and enable host access" }],
  },
  {
    id: "huggingface", title: "Hugging Face", description: "Search models, datasets, Spaces and papers on the Hub.",
    config: { url: "https://huggingface.co/mcp", headers: { Authorization: "Bearer ${HF_TOKEN}" } },
    creds: [{ name: "HF_TOKEN", label: "Access token", help: "https://huggingface.co/settings/tokens · or `hf auth login`" }],
  },
  {
    id: "google-calendar", title: "Google Calendar", description: "Read events and free/busy. Google's own MCP server; it needs a Google Cloud OAuth client.", prereg: true,
    config: { url: "https://calendarmcp.googleapis.com/mcp/v1", clientId: "${GOOGLE_MCP_CLIENT_ID}", clientSecret: "${GOOGLE_MCP_CLIENT_SECRET}" },
    creds: [
      { name: "GOOGLE_MCP_CLIENT_ID", label: "OAuth client id", help: "console.cloud.google.com → APIs & Services → Credentials → OAuth client (Desktop), after enabling calendarmcp.googleapis.com" },
      { name: "GOOGLE_MCP_CLIENT_SECRET", label: "OAuth client secret" },
    ],
  },
  {
    id: "google-gmail", title: "Gmail", description: "Search and read mail, create drafts. Google's own MCP server; it needs a Google Cloud OAuth client.", prereg: true,
    config: { url: "https://gmailmcp.googleapis.com/mcp/v1", clientId: "${GOOGLE_MCP_CLIENT_ID}", clientSecret: "${GOOGLE_MCP_CLIENT_SECRET}" },
    creds: [
      { name: "GOOGLE_MCP_CLIENT_ID", label: "OAuth client id", help: "Enable gmailmcp.googleapis.com in the same project" },
      { name: "GOOGLE_MCP_CLIENT_SECRET", label: "OAuth client secret" },
    ],
  },
  {
    id: "google-drive", title: "Google Drive", description: "Find and read files in Drive. Google's own MCP server; it needs a Google Cloud OAuth client.", prereg: true,
    config: { url: "https://drivemcp.googleapis.com/mcp/v1", clientId: "${GOOGLE_MCP_CLIENT_ID}", clientSecret: "${GOOGLE_MCP_CLIENT_SECRET}" },
    creds: [
      { name: "GOOGLE_MCP_CLIENT_ID", label: "OAuth client id", help: "Enable drivemcp.googleapis.com in the same project" },
      { name: "GOOGLE_MCP_CLIENT_SECRET", label: "OAuth client secret" },
    ],
  },
  {
    id: "papers", title: "Paper search", description: "Search and read arXiv, PubMed, bioRxiv, Semantic Scholar papers.", config: { command: "uvx", args: ["--from", "paper-search-mcp", "python", "-m", "paper_search_mcp.server"] }, creds: [], needs: "uv",
  },
  {
    id: "postgres", title: "Postgres", description: "Schema inspection, read-only SQL, query plans and index advice (postgres-mcp, restricted mode).",
    config: { command: "uvx", args: ["postgres-mcp", "--access-mode=restricted"], env: { DATABASE_URI: "${POSTGRES_URL}" } },
    creds: [{ name: "POSTGRES_URL", label: "Connection URL", help: "postgresql://user:pass@host:5432/db" }], needs: "uv",
  },
];

/** Popular servers whose job the built-in tools already do. */
export const BUILTIN: Record<string, string> = {
  filesystem: "fs_* tools (with Home folder access)",
  fetch: "web_fetch",
  firecrawl: "web_search / web_fetch / web_extract",
  "brave-search": "web_search",
  puppeteer: "browser",
  playwright: "browser",
  memory: "the remember tool",
  git: "shell / host_shell",
  "pdf-reader": "fs_read, the PDF viewer and the documents skill",
  "sequential-thinking": "",
};
export const overlapOf = (name: string) => {
  const n = name.toLowerCase();
  const k = Object.keys(BUILTIN).find((b) => n.split(/[/@._-]+/).includes(b) || n.endsWith("/" + b) || n.includes("server-" + b));
  return k ? BUILTIN[k] : null;
};

export const SKILL_REPOS: SkillRepo[] = [
  { source: "Leonxlnx/taste-skill", title: "Taste skills", description: "Anti-generic frontend design direction: minimalist, editorial, brutalist, redesign audits, full-output enforcement." },
  { source: "anthropics/skills", title: "Anthropic skills", description: "Document formats, frontend design, MCP builder, web app testing, brand and art skills." },
  { source: "vercel-labs/agent-skills", title: "Vercel agent skills", description: "React and Next.js performance rules, web interface guidelines." },
  { source: "vercel-labs/skills", title: "find-skills", description: "Lets the agent search the skills.sh directory for more skills." },
  { source: "addyosmani/agent-skills", title: "Addy Osmani skills", description: "Web performance, accessibility and engineering workflows." },
];

/** A catalog server that works with no account at all (nothing to sign in for). */
export const keyless = (id: string) => {
  const e = MCP_CATALOG.find((x) => x.id === id);
  return !!e && !e.oauth && !e.prereg && e.creds.every((c) => c.optional);
};

export type RegEntry = { name: string; description: string; url: string | null; pkg: { registry: string; id: string } | null; overlap: string | null };

/** Search the official MCP registry (registry.modelcontextprotocol.io) — public, no key. */
export async function registrySearch(q: string): Promise<RegEntry[]> {
  const r = await fetch(`https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(q)}&limit=20`, { signal: AbortSignal.timeout(15000) });
  const j = (await r.json()) as { servers?: { server?: Record<string, unknown> }[] };
  return (j.servers || []).map((x) => {
    const s = (x.server || x) as { name?: string; description?: string; packages?: { registryType?: string; identifier?: string; registry_name?: string; name?: string }[]; remotes?: { url?: string }[] };
    const pkg = s.packages?.[0]; const remote = s.remotes?.[0];
    return {
      name: s.name || "", description: s.description || "",
      url: remote?.url || null,
      pkg: pkg ? { registry: pkg.registryType || pkg.registry_name || "", id: pkg.identifier || pkg.name || "" } : null,
      overlap: overlapOf(s.name || ""),
    };
  }).filter((x) => x.name);
}
