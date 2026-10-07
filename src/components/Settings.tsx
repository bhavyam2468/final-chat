"use client";
import { useEffect, useState } from "react";
import { X, Plus } from "lucide-react";
import { Mcp, Skills } from "./Extensions";

type S = { provider: string; baseUrl: string; apiKey: string; model: string; contextTokens: number; workingTokens?: number; searxngUrl: string; firecrawlEnabled: boolean; firecrawlUrl: string; firecrawlKey: string; firecrawlCloudUrl?: string; access: "sandbox" | "home" | "full"; terminal: "sandbox" | "host"; sudo: boolean; phone?: boolean; secrets: Record<string, string>; vision: boolean; quality: "off" | "warn" | "fix"; toolLoading: "auto" | "all" | "lean" };
type Caps = { bwrap: boolean; soffice: boolean; home: string; workspace: string; platform: string; locked?: boolean };
type Srv = { command?: string; args?: string[]; url?: string; headers?: Record<string, string>; env?: Record<string, string>; enabled?: boolean };

export function Settings({ onClose, theme, setTheme, initialTab }: { onClose: () => void; theme: string; setTheme: (t: string) => void; initialTab?: "model" | "tools" | "access" | "mcp" | "skills" }) {
  const [tab, setTab] = useState<"model" | "tools" | "access" | "mcp" | "skills">(initialTab || "model");
  const [lastTab, setLastTab] = useState(initialTab);
  if (initialTab && initialTab !== lastTab) { setLastTab(initialTab); setTab(initialTab); } // adjust to the palette's pick while rendering
  const [caps, setCaps] = useState<Caps | null>(null);
  const [s, setS] = useState<S | null>(null);
  const [presets, setPresets] = useState<Record<string, { baseUrl: string; model: string; contextTokens?: number }>>({});
  const [servers, setServers] = useState<Record<string, Srv>>({});
  const [msg, setMsg] = useState("");
  const [secretK, setSecretK] = useState(""); const [secretV, setSecretV] = useState("");
  const [models, setModels] = useState<{ id: string; name?: string; contextWindow?: number; status?: string }[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((j) => { setS(j.settings); setPresets(j.presets); setCaps(j.caps || null); });
    fetch("/api/mcp").then((r) => r.json()).then(setServers);
  }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose]);

  const saveS = async (patch: Partial<S>) => { const r = await fetch("/api/settings", { method: "PUT", body: JSON.stringify(patch) }).then((r) => r.json()); setS(r.settings); flash("Saved"); };
  const reloadSrv = () => fetch("/api/mcp").then((r) => r.json()).then(setServers);
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
    <div className="panel settings" role="region" aria-label="Settings">
        <div className="panel-head">
          <span>Settings</span><span className="sp" />
          <small style={{ color: "var(--muted)", fontSize: 12 }}>{msg}</small>
          <button className="ib sm" aria-label="Close settings" onClick={onClose}><X /></button>
        </div>
        <div className="tabs" role="tablist">
          <div className="seg">{(["model", "tools", "access", "mcp", "skills"] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t === "mcp" ? "MCP" : t[0].toUpperCase() + t.slice(1)}</button>)}</div>
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
                  <button type="button" className="mini" onClick={fetchModels} disabled={loadingModels}>{loadingModels ? "Fetching…" : "Fetch models"}</button>
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
            {F("Working context per request (tokens)", "workingTokens", "number")}
            <div className="srv"><div className="t">Vision<small>{s.vision ? "The model sees images: uploads, view_image, screenshots from browser and checks." : "Off: images are described by path only. Use for text-only models."}</small></div>
              <button className={"sw" + (s.vision ? " on" : "")} aria-label="Vision" onClick={() => saveS({ vision: !s.vision })} /></div>
            <label className="field">Theme<select value={theme} onChange={(e) => setTheme(e.target.value)}><option value="dark">Dark</option><option value="light">Light</option></select></label>
          </>}
          {tab === "tools" && <>
            {F("Local SearXNG URL (search discovery)", "searxngUrl")}
            <div className="srv"><div className="t">Local-first web research<small>Search uses SearXNG when available, then lightweight keyless fallbacks. Pages use direct HTTP plus Mozilla Readability; no browser starts for ordinary research.</small></div>
              <button className={"sw" + (s.searxngUrl ? " on" : "")} aria-label="Local SearXNG" onClick={() => saveS({ searxngUrl: s.searxngUrl ? "" : "http://localhost:8080" })} /></div>
            <div className="grid2">
              {F("Local Firecrawl URL (optional fallback)", "firecrawlUrl")}
              {F("Online Firecrawl key (optional)", "firecrawlKey", "password")}
            </div>
            <div className="srv"><div className="t">Allow Firecrawl escalation<small>{s.firecrawlEnabled ? "On: use only after lightweight HTTP extraction fails, for explicit difficult-page fallbacks." : "Off by default: Firecrawl and its local browser never run during ordinary search or fetch."}</small></div>
              <button className={"sw" + (s.firecrawlEnabled ? " on" : "")} aria-label="Enable Firecrawl fallback" onClick={() => saveS({ firecrawlEnabled: !s.firecrawlEnabled })} /></div>
            <small style={{ color: "var(--muted)", fontSize: 11, marginTop: -2, marginBottom: 8, display: "block" }}>
              Firecrawl remains available for JavaScript-heavy, anti-bot, or unsupported pages, and for structured extraction when configured. It is never the ordinary path unless enabled here.
            </small>
            <div className="grid2">
              <label className="field">Quality guard<select value={s.quality} onChange={(e) => saveS({ quality: e.target.value as S["quality"] })}>
                <option value="fix">Check and repair</option><option value="warn">Check only</option><option value="off">Off</option></select></label>
              <label className="field">Developer tools<select value={s.toolLoading} onChange={(e) => saveS({ toolLoading: e.target.value as S["toolLoading"] })}>
                <option value="auto">Auto (on demand below 48k context)</option><option value="lean">On demand</option><option value="all">Always loaded</option></select></label>
            </div>
            <small className="note">Quality guard lints UI files the agent writes (generic AI styling, broken syntax) and lets it repair once. Developer tools (processes, browser, checks) load when a build, debug or design skill opens.</small>
            <div className="field">Secrets: name and value, used as ${"{NAME}"} in MCP configs
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
              <button className={"sw" + (s.terminal === "host" ? " on" : "")} disabled={caps?.locked} aria-label="Host terminal" onClick={() => saveS({ terminal: s.terminal === "host" ? "sandbox" : "host", ...(s.terminal === "host" ? { sudo: false, phone: false } : {}) })} /></div>
            <div className={"srv" + (s.terminal !== "host" ? " off" : "")}><div className="t">Allow sudo<small>{s.terminal !== "host" ? "Requires the host terminal." : s.secrets.SUDO_PASSWORD ? "Uses the SUDO_PASSWORD secret." : "Passwordless sudo only (sudo -n). Add a SUDO_PASSWORD secret under Tools to allow password prompts."}</small></div>
              <button className={"sw" + (s.sudo ? " on" : "")} disabled={s.terminal !== "host"} aria-label="Allow sudo" onClick={() => { if (!s.sudo && !confirm("Let the agent run commands as root?")) return; saveS({ sudo: !s.sudo }); }} /></div>
            <div className={"srv" + (s.terminal !== "host" ? " off" : "")}><div className="t">Phone testing<small>{s.terminal !== "host" ? "Requires the host terminal." : "adb on a device you plugged in: install, launch, screenshot, tap, logcat. Every call shows in the chat."}</small></div>
              <button className={"sw" + (s.phone ? " on" : "")} disabled={s.terminal !== "host"} aria-label="Phone testing" onClick={() => saveS({ phone: !s.phone })} /></div>
            {caps && <small className="note">{caps.soffice ? "LibreOffice found: office files preview as pages." : "Install LibreOffice for page-accurate .doc/.ppt/.odp previews."}</small>}
          </>}
          {tab === "mcp" && <Mcp servers={servers} saveSrv={saveSrv} reload={reloadSrv} saveSecret={(k, v) => saveS({ secrets: { [k]: v } })} flash={flash} />}
          {tab === "skills" && <Skills flash={flash} />}
        </div>
    </div>
  );
}
