"use client";
import { useEffect, useState } from "react";
import { X, Plus } from "lucide-react";

type S = { provider: string; baseUrl: string; apiKey: string; model: string; contextTokens: number; firecrawlUrl: string; firecrawlKey: string; firecrawlCloudUrl?: string; access: "sandbox" | "home" | "full"; terminal: "sandbox" | "host"; sudo: boolean; secrets: Record<string, string> };
type Caps = { bwrap: boolean; soffice: boolean; home: string; workspace: string; platform: string; locked?: boolean };
type Srv = { command?: string; args?: string[]; url?: string; headers?: Record<string, string>; env?: Record<string, string>; enabled?: boolean };

export function Settings({ onClose, theme, setTheme }: { onClose: () => void; theme: string; setTheme: (t: string) => void }) {
  const [tab, setTab] = useState<"model" | "tools" | "access" | "mcp" | "skills">("model");
  const [caps, setCaps] = useState<Caps | null>(null);
  const [s, setS] = useState<S | null>(null);
  const [presets, setPresets] = useState<Record<string, { baseUrl: string; model: string; contextTokens?: number }>>({});
  const [servers, setServers] = useState<Record<string, Srv>>({});
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([]);
  const [reg, setReg] = useState<{ name: string; description: string; pkg: { registry: string; id: string } | null; url: string | null }[]>([]);
  const [q, setQ] = useState(""); const [skillSrc, setSkillSrc] = useState(""); const [msg, setMsg] = useState("");
  const [secretK, setSecretK] = useState(""); const [secretV, setSecretV] = useState("");
  const [newSrv, setNewSrv] = useState("");
  const [models, setModels] = useState<{ id: string; name?: string; contextWindow?: number; status?: string }[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((j) => { setS(j.settings); setPresets(j.presets); setCaps(j.caps || null); });
    fetch("/api/mcp").then((r) => r.json()).then(setServers);
    fetch("/api/skills").then((r) => r.json()).then(setSkills);
  }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose]);

  const saveS = async (patch: Partial<S>) => { const r = await fetch("/api/settings", { method: "PUT", body: JSON.stringify(patch) }).then((r) => r.json()); setS(r.settings); flash("Saved"); };
  const saveSrv = async (next: Record<string, Srv>) => { setServers(next); await fetch("/api/mcp", { method: "PUT", body: JSON.stringify(next) }); flash("Saved"); };
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 1400); };

  const fetchModels = async () => {
    if (!s) return;
    setLoadingModels(true);
    try {
      const res = await fetch(`/api/models?baseUrl=${encodeURIComponent(s.baseUrl)}`);
      const j = await res.json();
      if (j.models) {
        setModels(j.models);
        flash(`Fetched ${j.models.length} models`);
      } else {
        flash(j.error || "Failed to fetch models");
      }
    } catch (err: any) {
      flash(err?.message || "Failed to fetch models");
    } finally {
      setLoadingModels(false);
    }
  };

  if (!s) return null;
  const F = (label: string, k: keyof S, type = "text") => (
    <label className="field">{label}<input type={type} defaultValue={String(s[k] ?? "")} key={String(s[k])} onBlur={(e) => { const v = type === "number" ? Number(e.target.value) : e.target.value; if (v !== s[k]) saveS({ [k]: v } as Partial<S>); }} /></label>
  );

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog">
        <div className="tabs">
          <div className="seg">{(["model", "tools", "access", "mcp", "skills"] as const).map((t) => <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t === "mcp" ? "MCP" : t[0].toUpperCase() + t.slice(1)}</button>)}</div>
          <span style={{ flex: 1 }} /><small style={{ color: "var(--muted)", alignSelf: "center", fontSize: 12 }}>{msg}</small>
          <button className="ib sm" aria-label="Close" onClick={onClose}><X /></button>
        </div>
        <div className="content">
          {tab === "model" && <>
            <label className="field">Provider
              <select value={s.provider} onChange={(e) => { const p = presets[e.target.value]; saveS({ provider: e.target.value, ...(p?.baseUrl ? { baseUrl: p.baseUrl, model: p.model, ...(p.contextTokens ? { contextTokens: p.contextTokens } : {}) } : {}) }); }}>
                {Object.keys(presets).map((p) => <option key={p} value={p}>{p}</option>)}
              </select></label>
            {F("Base URL (OpenAI-compatible)", "baseUrl")}
            <div className="grid2">
              {F("API key", "apiKey", "password")}
              <div className="field">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Model</span>
                  <button
                    type="button"
                    style={{ fontSize: 11, padding: "2px 8px", cursor: "pointer", background: "var(--card-border, #333)", border: "none", borderRadius: 4, color: "var(--fg)" }}
                    onClick={fetchModels}
                    disabled={loadingModels}
                  >
                    {loadingModels ? "Fetching…" : "Fetch models"}
                  </button>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    type="text"
                    list="available-models"
                    defaultValue={String(s.model ?? "")}
                    key={String(s.model)}
                    onBlur={(e) => {
                      if (e.target.value !== s.model) {
                        const found = models.find((m) => m.id === e.target.value);
                        const patch: Partial<S> = { model: e.target.value };
                        if (found?.contextWindow) patch.contextTokens = found.contextWindow;
                        saveS(patch);
                      }
                    }}
                    style={{ flex: 1 }}
                  />
                  {models.length > 0 && (
                    <select
                      value={models.some((m) => m.id === s.model) ? s.model : ""}
                      onChange={(e) => {
                        if (e.target.value) {
                          const found = models.find((m) => m.id === e.target.value);
                          const patch: Partial<S> = { model: e.target.value };
                          if (found?.contextWindow) patch.contextTokens = found.contextWindow;
                          saveS(patch);
                        }
                      }}
                      style={{ width: 140 }}
                      aria-label="Select fetched model"
                    >
                      <option value="">Choose…</option>
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.id} {m.status && m.status !== "ready" ? `(${m.status})` : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <datalist id="available-models">
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name || m.id} {m.contextWindow ? `(${Math.round(m.contextWindow / 1000)}k ctx)` : ""}
                    </option>
                  ))}
                </datalist>
              </div>
            </div>
            {F("Context window (tokens)", "contextTokens", "number")}
            <label className="field">Theme<select value={theme} onChange={(e) => setTheme(e.target.value)}><option value="dark">Dark</option><option value="light">Light</option></select></label>
          </>}
          {tab === "tools" && <>
            <div className="grid2">
              {F("Local Firecrawl URL (zero-credit)", "firecrawlUrl")}
              {F("Online Firecrawl Key (bypass / extract)", "firecrawlKey", "password")}
            </div>
            <small style={{ color: "var(--muted)", fontSize: 11, marginTop: -6, marginBottom: 8, display: "block" }}>
              Hybrid routing: standard scrape uses local Firecrawl. Cloud API key is used for Cloudflare/anti-bot bypass, AI extraction, and search fallback.
            </small>
            <div className="field">Secrets for MCP (${"{NAME}"} in servers.json)
              {Object.keys(s.secrets).map((k) => <div key={k} className="srv"><span className="t">{k}</span><small>••••</small></div>)}
              <div className="grid2"><input value={secretK} onChange={(e) => setSecretK(e.target.value.toUpperCase())} aria-label="Secret name" /><div style={{ display: "flex", gap: 6 }}><input type="password" value={secretV} onChange={(e) => setSecretV(e.target.value)} aria-label="Secret value" style={{ flex: 1 }} /><button className="ib" aria-label="Add secret" onClick={() => { if (secretK && secretV) { saveS({ secrets: { [secretK]: secretV } }); setSecretK(""); setSecretV(""); } }}><Plus /></button></div></div>
            </div>
          </>}
          {tab === "access" && <>
            {caps?.locked && <small className="note">Locked to the sandbox by this server (HOST_ACCESS=off).</small>}
            <div className="srv"><div className="t">Home folder<small>{s.access === "sandbox" ? `Off: files are confined to ${caps?.workspace || "the workspace"}.` : `On: the agent can read and write ${caps?.home || "~"} (use ~/path).`}</small></div>
              <button className={"sw" + (s.access !== "sandbox" ? " on" : "")} disabled={caps?.locked} aria-label="Home folder access" onClick={() => saveS({ access: s.access === "sandbox" ? "home" : "sandbox" })} /></div>
            <div className={"srv" + (s.access === "sandbox" ? " off" : "")}><div className="t">Entire disk<small>Absolute paths outside your home folder.</small></div>
              <button className={"sw" + (s.access === "full" ? " on" : "")} disabled={caps?.locked || s.access === "sandbox"} aria-label="Entire disk access" onClick={() => saveS({ access: s.access === "full" ? "home" : "full" })} /></div>
            <div className="srv"><div className="t">Host terminal<small>{s.terminal === "host" ? `On: shell and Python run as you, starting in ${s.access === "sandbox" ? "the workspace" : caps?.home || "~"}.` : caps?.bwrap ? "Off: commands run isolated with bubblewrap, only the workspace is writable." : "Off: commands run in the workspace with secrets stripped. Install bubblewrap for full isolation."}</small></div>
              <button className={"sw" + (s.terminal === "host" ? " on" : "")} disabled={caps?.locked} aria-label="Host terminal" onClick={() => saveS({ terminal: s.terminal === "host" ? "sandbox" : "host", ...(s.terminal === "host" ? { sudo: false } : {}) })} /></div>
            <div className={"srv" + (s.terminal !== "host" ? " off" : "")}><div className="t">Allow sudo<small>{s.terminal !== "host" ? "Requires the host terminal." : s.secrets.SUDO_PASSWORD ? "Uses the SUDO_PASSWORD secret." : "Passwordless sudo only (sudo -n). Add a SUDO_PASSWORD secret under Tools to allow password prompts."}</small></div>
              <button className={"sw" + (s.sudo ? " on" : "")} disabled={s.terminal !== "host"} aria-label="Allow sudo" onClick={() => { if (!s.sudo && !confirm("Let the agent run commands as root?")) return; saveS({ sudo: !s.sudo }); }} /></div>
            {caps && <small className="note">{caps.soffice ? "LibreOffice found: office files preview as pages." : "Install LibreOffice for page-accurate .doc/.ppt/.odp previews."}</small>}
          </>}
          {tab === "mcp" && <>
            {Object.entries(servers).map(([name, c]) => (
              <div key={name} className="srv"><div className="t">{name}<small>{c.url || [c.command, ...(c.args || [])].join(" ")}</small></div>
                <button className="ib sm" aria-label="Remove" onClick={() => { const n = { ...servers }; delete n[name]; saveSrv(n); }}><X /></button>
                <button className={"sw" + (c.enabled ? " on" : "")} aria-label={`Toggle ${name}`} onClick={() => saveSrv({ ...servers, [name]: { ...c, enabled: !c.enabled } })} /></div>
            ))}
            <div style={{ display: "flex", gap: 6 }}>
              <input className="search" style={{ margin: 0, flex: 1 }} value={newSrv} onChange={(e) => setNewSrv(e.target.value)} aria-label="Add server: name = command args… or URL" />
              <button className="ib" aria-label="Add server" onClick={() => { const m = newSrv.match(/^\s*([\w-]+)\s*=\s*(.+)$/); if (!m) return; const v = m[2].trim(); saveSrv({ ...servers, [m[1]]: /^https?:/.test(v) ? { url: v, enabled: true } : { command: v.split(/\s+/)[0], args: v.split(/\s+/).slice(1), enabled: true } }); setNewSrv(""); }}><Plus /></button>
            </div>
            <input className="search" style={{ margin: 0, width: "100%" }} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search MCP registry" onKeyDown={(e) => { if (e.key === "Enter") fetch("/api/mcp/registry?q=" + encodeURIComponent(q)).then((r) => r.json()).then((j) => setReg(Array.isArray(j) ? j : [])); }} />
            {reg.map((r) => (
              <div key={r.name} className="srv"><div className="t">{r.name}<small>{r.description}</small></div>
                <button className="ib sm" aria-label="Install" onClick={() => {
                  const key = r.name.split("/").pop()!.replace(/[^\w-]/g, "-");
                  const cfg: Srv = r.url ? { url: r.url, enabled: false } : r.pkg?.registry === "pypi" ? { command: "uvx", args: [r.pkg.id], enabled: false } : r.pkg?.registry === "oci" ? { command: "docker", args: ["run", "-i", "--rm", r.pkg.id], enabled: false } : { command: "npx", args: ["-y", r.pkg?.id || r.name], enabled: false };
                  saveSrv({ ...servers, [key]: cfg });
                }}><Plus /></button></div>
            ))}
          </>}
          {tab === "skills" && <>
            {skills.map((k) => <div key={k.name} className="srv"><div className="t">{k.name}<small>{k.description}</small></div></div>)}
            <div style={{ display: "flex", gap: 6 }}>
              <input className="search" style={{ margin: 0, flex: 1 }} value={skillSrc} onChange={(e) => setSkillSrc(e.target.value)} aria-label="GitHub skill URL or owner/repo/path" />
              <button className="ib" aria-label="Install skill" onClick={async () => { const r = await fetch("/api/skills", { method: "POST", body: JSON.stringify({ source: skillSrc }) }).then((r) => r.json()); flash(r.error || "Installed " + r.name); setSkillSrc(""); fetch("/api/skills").then((r) => r.json()).then(setSkills); }}><Plus /></button>
            </div>
          </>}
        </div>
      </div>
    </div>
  );
}
