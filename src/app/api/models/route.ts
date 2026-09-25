import { NextRequest } from "next/server";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export type ModelItem = {
  id: string;
  name?: string;
  contextWindow?: number;
  available?: boolean;
  status?: string;
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const st = await getSettings();
  const baseUrl = url.searchParams.get("baseUrl") || st.baseUrl;
  const apiKey = url.searchParams.get("apiKey") || st.apiKey;
  return fetchModels(baseUrl, apiKey);
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const st = await getSettings();
  const baseUrl = b.baseUrl || st.baseUrl;
  const apiKey = b.apiKey || st.apiKey;
  return fetchModels(baseUrl, apiKey);
}

async function fetchModels(baseUrl: string, apiKey: string) {
  if (!baseUrl) {
    return Response.json({ error: "Base URL is required" }, { status: 400 });
  }

  const endpoint = baseUrl.replace(/\/$/, "") + "/models";

  try {
    const res = await fetch(endpoint, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return Response.json(
        { error: `Provider error (${res.status}): ${errText.slice(0, 300)}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    const rawList = Array.isArray(data)
      ? data
      : Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.models)
      ? data.models
      : [];

    const models: ModelItem[] = rawList.map((m: any) => ({
      id: m.id || m.name || String(m),
      name: m.name || m.id,
      contextWindow: m.context_window || m.context_length || m.max_context_length,
      available: m.available !== false,
      status: m.execution_status || (m.available === false ? "unavailable" : "ready"),
    }));

    // Sort ready/available models first
    models.sort((a, b) => {
      const aReady = a.status === "ready" || a.available ? 1 : 0;
      const bReady = b.status === "ready" || b.available ? 1 : 0;
      if (aReady !== bReady) return bReady - aReady;
      return a.id.localeCompare(b.id);
    });

    return Response.json({ models, count: models.length });
  } catch (err: any) {
    return Response.json(
      { error: `Failed to connect to ${endpoint}: ${err?.message || String(err)}` },
      { status: 502 }
    );
  }
}
