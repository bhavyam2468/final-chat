"use client";
import { useCallback, useEffect, useState } from "react";
import { X, Plus, Check } from "lucide-react";

type Srv = { command?: string; args?: string[]; url?: string; headers?: Record<string, string>; env?: Record<string, string>; enabled?: boolean };
type Cred = { name: string; label: string; help?: string; optional?: boolean; source?: string | null };
type Entry = { id: string; title: string; description: string; config: Srv; creds: Cred[]; installed: boolean; enabled: boolean; missingBin: string | null; needs?: string; oauth?: boolean; prereg?: boolean; featured?: boolean };
type Installed = { vars: Record<string, string | null>; overlap: string | null; oauth?: boolean; connected?: boolean; pending?: boolean; error?: string };
type Market = { native: boolean; mcp: Entry[]; installed: Record<string, Installed>; builtin: Record<string, string>; skills: { source: string; title: string; description: string }[] };
type Reg = { name: string; description: string; pkg: { registry: string; id: string } | null; url: string | null; overlap: string | null };

const srcLabel = (s: string | null | undefined) => (!s ? "missing" : s === "secret" ? "saved" : s === "env" ? "from environment" : `from ${s}`);

/** Credential row: shows where a ${VAR} resolves from; lets the user paste one if missing. */
function CredRow({ name, source, help, save }: { name: string; source: string | null | undefined; help?: string; save: (k: string, v: string) => Promise<void> }) {
  const [v, setV] = useState("");
  return (
    <div className="cred">
      <code>{name}</code><span className={"badge" + (source ? " ok" : " warn")}>{srcLabel(source)}</span>
      {!source && <>
        <input type="password" value={v} onChange={(e) => setV(e.target.value)} aria-label={`${name} value`} onKeyDown={(e) => { if (e.key === "Enter" && v) save(name, v).then(() => setV("")); }} />
        <button className="ib sm" aria-label={`Save ${name}`} disabled={!v} onClick={() => save(name, v).then(() => setV(""))}><Check /></button>
      </>}
      {!source && help && <small className="note">{help}</small>}
    </div>
  );
}

export function Mcp({ servers, saveSrv, reload, saveSecret, flash }: { servers: Record<string, Srv>; saveSrv: (n: Record<string, Srv>) => Promise<void>; reload: () => Promise<void>; saveSecret: (k: string, v: string) => Promise<void>; flash: (m: string) => void }) {
  const [m, setM] = useState<Market | null>(null);
  const [q, setQ] = useState(""); const [reg, setReg] = useState<Reg[]>([]); const [newSrv, setNewSrv] = useState("");
  const load = useCallback(() => fetch("/api/market").then((r) => r.json()).then(setM), []);
  useEffect(() => { load(); }, [load, servers]);
  const secret = async (k: string, v: string) => { await saveSecret(k, v); await load(); };
  const help = (name: string) => m?.mcp.flatMap((e) => e.creds).find((c) => c.name === name)?.help;
  const available = m?.mcp.filter((e) => !e.installed) || [];

  return <>
    <h4 className="sec">Installed</h4>
    {!Object.keys(servers).length && <small className="note">None.</small>}
    {Object.entries(servers).map(([name, c]) => {
      const info = m?.installed[name];
      return (
        <div key={name} className="srv col">
          <div className="row">
            <div className="t">{name}<small>{c.url || [c.command, ...(c.args || [])].join(" ")}</small></div>
            <button className="ib sm" aria-label={`Remove ${name}`} onClick={() => { const n = { ...servers }; delete n[name]; saveSrv(n); }}><X /></button>
            <button className={"sw" + (c.enabled ? " on" : "")} aria-label={`Toggle ${name}`} onClick={() => saveSrv({ ...servers, [name]: { ...c, enabled: !c.enabled } })} />
          </div>
          {info?.overlap && <small className="note">Duplicates a built-in tool: {info.overlap}.</small>}
          {c.url && <OAuthRow name={name} info={info} reload={reload} flash={flash} />}
          {info && Object.entries(info.vars).map(([k, src]) => <CredRow key={k} name={k} source={src} help={help(k)} save={secret} />)}
        </div>
      );
    })}

    {available.length > 0 && <h4 className="sec">Add an integration <small>one click when the service supports it; no API keys to copy</small></h4>}
    {available.map((e) => (
      <div key={e.id} className="srv col">
        <div className="row">
          <div className="t">{e.title}{e.oauth && <span className="badge ok">one-click sign-in</span>}<small>{e.description}</small></div>
          <button className="mini" disabled={!!e.missingBin} onClick={async () => { await fetch("/api/market", { method: "POST", body: JSON.stringify({ id: e.id }) }); await reload(); flash(e.oauth || e.prereg ? `Added ${e.title} — press Connect` : `Added ${e.title}`); }}>Add</button>
        </div>
        {e.missingBin && <small className="note">Needs {e.missingBin === "uv" ? "uv (curl -LsSf https://astral.sh/uv/install.sh | sh)" : e.missingBin}.</small>}
        {e.prereg && <small className="note">Google Cloud OAuth client: {e.creds.map((c) => c.name).join(" + ")} in Tools → Secrets, then Connect.</small>}
        {!e.prereg && e.creds.map((c) => <div key={c.name} className="cred"><code>{c.name}</code><span className={"badge" + (c.source ? " ok" : "")}>{c.source ? srcLabel(c.source) : "needed"}</span></div>)}
      </div>
    ))}
    {m && !m.native && <small className="note">Existing CLI logins (gh, hf) are reused once Home folder or Host terminal access is on.</small>}
    {m && <small className="note">Built in, no server needed: {Object.entries(m.builtin).filter(([k], i, a) => a.findIndex(([, v]) => v === m.builtin[k]) === i).map(([k, v]) => `${k} → ${v}`).join(" · ")}</small>}

    <h4 className="sec">Custom <small>name = command args, or name = URL</small></h4>
    <div style={{ display: "flex", gap: 6 }}>
      <input className="search" style={{ margin: 0, flex: 1 }} value={newSrv} onChange={(e) => setNewSrv(e.target.value)} aria-label="Add server: name = command args… or URL" />
      <button className="ib" aria-label="Add server" onClick={() => { const mm = newSrv.match(/^\s*([\w-]+)\s*=\s*(.+)$/); if (!mm) return; const v = mm[2].trim(); saveSrv({ ...servers, [mm[1]]: /^https?:/.test(v) ? { url: v, enabled: true } : { command: v.split(/\s+/)[0], args: v.split(/\s+/).slice(1), enabled: true } }); setNewSrv(""); }}><Plus /></button>
    </div>
    <h4 className="sec">Registry</h4>
    <input className="search" style={{ margin: 0, width: "100%" }} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the MCP registry" onKeyDown={(e) => { if (e.key === "Enter") fetch("/api/mcp/registry?q=" + encodeURIComponent(q)).then((r) => r.json()).then((j) => setReg(Array.isArray(j) ? j : [])); }} />
    {reg.map((r) => (
      <div key={r.name} className={"srv" + (r.overlap ? " off" : "")}><div className="t">{r.name}<small>{r.overlap ? `Built in: ${r.overlap}` : r.description}</small></div>
        <button className="ib sm" aria-label={`Install ${r.name}`} onClick={() => {
          const key = r.name.split("/").pop()!.replace(/[^\w-]/g, "-");
          const cfg: Srv = r.url ? { url: r.url, enabled: false } : r.pkg?.registry === "pypi" ? { command: "uvx", args: [r.pkg.id], enabled: false } : r.pkg?.registry === "oci" ? { command: "docker", args: ["run", "-i", "--rm", r.pkg.id], enabled: false } : { command: "npx", args: ["-y", r.pkg?.id || r.name], enabled: false };
          saveSrv({ ...servers, [key]: cfg });
        }}><Plus /></button></div>
    ))}
  </>;
}

/**
 * Sign-in for a remote server: one click opens the service, which returns to this app with a code.
 * When the browser cannot reach the app (hosted or remote), the same flow finishes with a pasted code.
 */
function OAuthRow({ name, info, reload, flash }: { name: string; info?: Installed; reload: () => Promise<void>; flash: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  if (!info?.oauth) return null;
  const post = (body: Record<string, unknown>) => fetch("/api/mcp/oauth", { method: "POST", body: JSON.stringify({ name, ...body }) }).then((r) => r.json());
  const connect = async () => {
    setBusy(true); setErr("");
    const r = await post({}).catch((e) => ({ error: String(e) }));
    setBusy(false);
    if (r.error) { setErr(r.error); flash("Sign-in failed"); return; }
    if (r.connected) { flash(`${name} is connected`); await reload(); return; }
    if (r.url) { setUrl(r.url); window.open(r.url, "_blank", "noopener"); }
  };
  const finish = async () => {
    setBusy(true); setErr("");
    const r = await post({ code }).catch((e) => ({ error: String(e) }));
    setBusy(false);
    if (r.error) { setErr(r.error); return; }
    setUrl(""); setCode(""); flash(`${name} is connected`); await reload();
  };
  return (
    <div className="cred" style={{ flexWrap: "wrap" }}>
      <span className={"badge" + (info.connected ? " ok" : "")}>{info.connected ? "connected" : info.pending ? "finish sign-in" : "not signed in"}</span>
      <button className="mini" disabled={busy} onClick={connect}>{busy ? "…" : info.connected ? "Reconnect" : "Connect"}</button>
      {info.connected && <button className="mini" onClick={async () => { await fetch("/api/mcp/oauth?name=" + encodeURIComponent(name), { method: "DELETE" }); await reload(); flash("Signed out"); }}>Sign out</button>}
      {url && <div style={{ flexBasis: "100%" }}>
        <small className="note">Approve access in the tab that opened, or open this link: <a href={url} target="_blank" rel="noreferrer">sign in</a>. If the browser cannot reach this app, copy the code the service shows into the box.</small>
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="authorization code" aria-label="Authorization code" onKeyDown={(e) => e.key === "Enter" && code && finish()} />
          <button className="ib sm" aria-label="Finish sign-in" disabled={!code || busy} onClick={finish}><Check /></button>
        </div>
      </div>}
      {(err || info.error) && <small className="note" style={{ flexBasis: "100%", color: "var(--accent)" }}>{err || info.error}</small>}
    </div>
  );
}

type Sk = { name: string; description: string; tools: string; requires: string; root: string; builtin: boolean; source: string };
export function Skills({ flash }: { flash: (m: string) => void }) {
  const [list, setList] = useState<Sk[]>([]);
  const [repos, setRepos] = useState<Market["skills"]>([]);
  const [src, setSrc] = useState(""); const [busy, setBusy] = useState("");
  const [pick, setPick] = useState<{ source: string; available: string[]; skipped: string[] } | null>(null);
  const load = useCallback(() => fetch("/api/skills").then((r) => r.json()).then(setList), []);
  useEffect(() => { load(); fetch("/api/market").then((r) => r.json()).then((j) => setRepos(j.skills || [])); }, [load]);

  const install = async (source: string, names?: string[]) => {
    setBusy(source);
    const r = await fetch("/api/skills", { method: "POST", body: JSON.stringify({ source, pick: names }) }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
    setBusy("");
    if (r.error) return flash(r.error);
    if (!r.installed.length && r.available.length > 1 && !names) return setPick({ source, available: r.available, skipped: r.skipped || [] });
    setPick(null); setSrc(""); load();
    flash(r.installed.length ? `Installed ${r.installed.join(", ")}` : r.skipped?.length ? `Already built in: ${r.skipped.join(", ")}` : "Nothing installed");
  };
  const tag = (k: Sk) => [k.tools === "dev" && "dev tools", k.requires === "host-terminal" && "host terminal", k.requires === "host-files" && "home folder", k.root !== "system/skills" && k.root, k.source && k.source.split("/").slice(0, 2).join("/")].filter(Boolean) as string[];

  return <>
    <h4 className="sec">Installed</h4>
    {list.map((k) => (
      <div key={k.root + k.name} className="srv"><div className="t">{k.name} {tag(k).map((t) => <span key={t} className="badge">{t}</span>)}<small>{k.description}</small></div>
        {!k.builtin && <button className="ib sm" aria-label={`Remove ${k.name}`} onClick={async () => { await fetch("/api/skills?name=" + encodeURIComponent(k.name), { method: "DELETE" }); load(); }}><X /></button>}
      </div>
    ))}
    <h4 className="sec">Get more</h4>
    {repos.map((r) => (
      <div key={r.source} className="srv col">
        <div className="row"><div className="t">{r.title}<small>{r.source} · {r.description}</small></div>
          <button className="mini" disabled={!!busy} onClick={() => install(r.source)}>{busy === r.source ? "Loading…" : "Browse"}</button></div>
        {pick?.source === r.source && <PickList pick={pick} installed={list.map((x) => x.name)} onInstall={(n) => install(r.source, n)} />}
      </div>
    ))}
    <div style={{ display: "flex", gap: 6 }}>
      <input className="search" style={{ margin: 0, flex: 1 }} value={src} onChange={(e) => setSrc(e.target.value)} aria-label="GitHub skill source" onKeyDown={(e) => e.key === "Enter" && src && install(src)} />
      <button className="ib" aria-label="Install skill" disabled={!src || !!busy} onClick={() => install(src)}><Plus /></button>
    </div>
    {pick && !repos.some((r) => r.source === pick.source) && <PickList pick={pick} installed={list.map((x) => x.name)} onInstall={(n) => install(pick.source, n)} />}
    <small className="note">Sources: owner/repo, owner/repo/path or a GitHub URL. Skills installed with <code>npx skills add owner/repo</code> in the workspace (.agents/skills) appear here too.</small>
  </>;
}

function PickList({ pick, installed, onInstall }: { pick: { available: string[]; skipped: string[] }; installed: string[]; onInstall: (names: string[]) => void }) {
  const [sel, setSel] = useState<string[]>([]);
  return (
    <div className="picks">
      {pick.available.map((n) => {
        const has = installed.includes(n);
        return <button key={n} className={"chip" + (sel.includes(n) ? " on" : "")} disabled={has} title={has ? "Installed" : undefined} onClick={() => setSel((s) => (s.includes(n) ? s.filter((x) => x !== n) : [...s, n]))}>{n}</button>;
      })}
      <button className="mini" disabled={!sel.length} onClick={() => onInstall(sel)}>Install {sel.length || ""}</button>
    </div>
  );
}
