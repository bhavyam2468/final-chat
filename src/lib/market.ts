import type { ServerCfg } from "./mcp";

/**
 * Curated extensions. Rule: nothing that duplicates a built-in tool (files, fetch/scrape, browser, shell,
 * python, memory); those are listed in BUILTIN so the UI can say why they are absent. Credentials are
 * ${VARS}: resolved from Settings secrets → environment → native CLI logins (see credentials.ts).
 */
export type Cred = { name: string; label: string; help?: string; optional?: boolean };
export type McpEntry = { id: string; title: string; description: string; config: ServerCfg; creds: Cred[]; needs?: string };
export type SkillRepo = { source: string; title: string; description: string };

export const MCP_CATALOG: McpEntry[] = [
  {
    id: "github", title: "GitHub", description: "Repositories, issues, pull requests, code search, Actions (GitHub's official remote server).",
    config: { url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "Bearer ${GITHUB_TOKEN}" } },
    creds: [{ name: "GITHUB_TOKEN", label: "Personal access token", help: "https://github.com/settings/personal-access-tokens · or sign in with `gh auth login` and enable host access" }],
  },
  {
    id: "context7", title: "Context7", description: "Current, version-specific library documentation and code examples.",
    config: { url: "https://mcp.context7.com/mcp" }, creds: [],
  },
  {
    id: "huggingface", title: "Hugging Face", description: "Search models, datasets, Spaces and papers on the Hub.",
    config: { url: "https://huggingface.co/mcp", headers: { Authorization: "Bearer ${HF_TOKEN}" } },
    creds: [{ name: "HF_TOKEN", label: "Access token", help: "https://huggingface.co/settings/tokens · or `hf auth login`" }],
  },
  {
    id: "postgres", title: "Postgres", description: "Schema inspection, read-only SQL, query plans and index advice (postgres-mcp, restricted mode).",
    config: { command: "uvx", args: ["postgres-mcp", "--access-mode=restricted"], env: { DATABASE_URI: "${POSTGRES_URL}" } },
    creds: [{ name: "POSTGRES_URL", label: "Connection URL", help: "postgresql://user:pass@host:5432/db" }], needs: "uv",
  },
  {
    id: "supabase", title: "Supabase", description: "Projects, tables, SQL, logs and edge functions (read-only).",
    config: { command: "npx", args: ["-y", "@supabase/mcp-server-supabase@latest", "--read-only"], env: { SUPABASE_ACCESS_TOKEN: "${SUPABASE_ACCESS_TOKEN}" } },
    creds: [{ name: "SUPABASE_ACCESS_TOKEN", label: "Personal access token", help: "https://supabase.com/dashboard/account/tokens" }], needs: "npx",
  },
  {
    id: "papers", title: "Paper search", description: "Search and read arXiv, PubMed, bioRxiv, Semantic Scholar papers.",
    config: { command: "uvx", args: ["--from", "paper-search-mcp", "python", "-m", "paper_search_mcp.server"] }, creds: [], needs: "uv",
  },
  {
    id: "chroma", title: "Chroma", description: "Local vector store for notes and documents; semantic search.",
    config: { command: "uvx", args: ["chroma-mcp", "--client-type", "persistent", "--data-dir", "./.chroma"] }, creds: [], needs: "uv",
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
  memory: "AGENTS.md memory",
  git: "shell / host_shell",
  "pdf-reader": "fs_read and the PDF viewer",
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
