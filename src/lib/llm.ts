import type { Settings } from "./settings";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OAMsg = { role: string; content: any; tool_calls?: any[]; tool_call_id?: string };

/** ~3.6 chars/token is a decent cross-model estimate for mixed prose/code. */
export const est = (s: string) => Math.ceil((s || "").length / 3.6);
export const estMsg = (m: OAMsg) => est(typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "").slice(0, 6000)) + (m.tool_calls ? est(JSON.stringify(m.tool_calls)) : 0) + 4;

export const endpoint = (st: Settings) => st.baseUrl.replace(/\/$/, "") + "/chat/completions";
export const headers = (st: Settings) => ({ "Content-Type": "application/json", Authorization: `Bearer ${st.apiKey}` });

/** One-shot, non-streaming completion used for summaries/compaction. */
export async function complete(st: Settings, msgs: OAMsg[], max = 1200): Promise<string> {
  const r = await fetch(endpoint(st), { method: "POST", headers: headers(st), body: JSON.stringify({ model: st.model, messages: msgs, max_tokens: max }) });
  if (!r.ok) throw new Error(`LLM ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return (j.choices?.[0]?.message?.content as string) || "";
}

/** Merge consecutive same-role messages so strict providers (Gemini, some local servers) accept the history. */
export function normalize(msgs: OAMsg[]): OAMsg[] {
  const out: OAMsg[] = [];
  for (const m of msgs) {
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role && (m.role === "user" || m.role === "assistant") && !prev.tool_calls && !m.tool_calls) {
      if (typeof prev.content === "string" && typeof m.content === "string") prev.content = `${prev.content}\n\n${m.content}`;
      else {
        const arr = (x: OAMsg["content"]) => (typeof x === "string" ? [{ type: "text", text: x }] : x || []);
        prev.content = [...arr(prev.content), ...arr(m.content)];
      }
    } else out.push({ ...m });
  }
  return out;
}
