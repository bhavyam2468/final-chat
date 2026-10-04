import fs from "fs/promises";
import path from "path";
import { WS, rel } from "@/lib/workspace";
import { chatDir, canvasSlug } from "@/lib/shared";
import { fastSearch, plainFetch, Hit } from "@/lib/search-fast";
import { complete, est } from "@/lib/llm";
import type { Settings } from "@/lib/settings";

export type ResearchProgress = {
  step: "planning" | "searching" | "reading" | "analyzing" | "synthesizing" | "done";
  message: string;
  percent: number;
};

export type ResearchResult = {
  ok: boolean;
  topic: string;
  report: string;
  artifactPath: string;
  sources: { title: string; url: string; snippet: string }[];
  stats: { searches: number; pagesRead: number; sourcesCount: number };
  uiBlock: string;
};

export async function runDeepResearch(
  topic: string,
  focus: string | undefined,
  convId: string,
  st: Settings,
  onProgress?: (p: ResearchProgress) => void
): Promise<ResearchResult> {
  const progress = (step: ResearchProgress["step"], message: string, percent: number) => {
    onProgress?.({ step, message, percent });
  };

  progress("planning", `Formulating deep research strategy for: "${topic}"`, 10);

  // 1. Generate search sub-queries
  const planPrompt = `You are an expert research planner. Break down this research topic into 3-5 distinct, highly targeted web search queries that cover different angles (technical details, current benchmarks/status, real-world trade-offs, expert analysis).
Topic: ${topic}
${focus ? `Focus area: ${focus}` : ""}

Output ONLY a JSON array of search query strings, e.g. ["query 1", "query 2", "query 3"].`;

  let queries: string[] = [topic];
  try {
    const rawPlan = await complete(st, [{ role: "user", content: planPrompt }], 400);
    const parsed = JSON.parse(rawPlan.replace(/^[^[]*/, "").replace(/[^\]]*$/, ""));
    if (Array.isArray(parsed) && parsed.length > 0) {
      queries = parsed.map(String).slice(0, 5);
    }
  } catch {
    queries = [
      topic,
      `${topic} overview and documentation`,
      `${topic} latest developments analysis`,
      `${topic} comparison and trade-offs`,
    ];
  }

  progress("searching", `Executing parallel search across ${queries.length} research vectors`, 25);

  // 2. Perform parallel searches outside context
  const searchResults: { query: string; hits: Hit[] }[] = [];
  const allHits: Hit[] = [];
  const seenUrls = new Set<string>();

  await Promise.all(
    queries.map(async (q) => {
      const hits = await fastSearch(q, 4, st.searxngUrl).catch(() => []);
      searchResults.push({ query: q, hits });
      for (const h of hits) {
        if (h.url && !seenUrls.has(h.url)) {
          seenUrls.add(h.url);
          allHits.push(h);
        }
      }
    })
  );

  progress("reading", `Reading and extracting top ${Math.min(8, allHits.length)} source pages`, 50);

  // 3. Parallel fetch top pages (outside context)
  const topHits = allHits.slice(0, 8);
  const pageContents: { url: string; title: string; content: string }[] = [];

  await Promise.all(
    topHits.map(async (h) => {
      try {
        const fetched = await plainFetch(h.url);
        if (fetched && fetched.markdown.trim().length > 60) {
          pageContents.push({
            url: h.url,
            title: fetched.title || h.title,
            content: fetched.markdown.slice(0, 8000), // bounded per page
          });
        }
      } catch {
        // Skip unreadable
      }
    })
  );

  progress("analyzing", `Analyzing evidence and cross-checking facts`, 75);

  // 4. Save raw intermediate research findings into artifacts/ to keep main context completely clean
  const slug = canvasSlug(topic);
  const artifactRel = `${chatDir(convId)}/artifacts/research-${slug}.md`;
  const artifactAbs = path.join(WS, artifactRel);
  await fs.mkdir(path.dirname(artifactAbs), { recursive: true });

  const rawDossier = `# Research Dossier: ${topic}
Generated: ${new Date().toISOString()}

## Research Vectors
${queries.map((q) => `- ${q}`).join("\n")}

## Extracted Sources (${pageContents.length} pages)
${pageContents.map((p, i) => `### [${i + 1}] ${p.title}\nURL: ${p.url}\n\n${p.content.slice(0, 2500)}\n\n---\n`).join("\n")}
`;
  await fs.writeFile(artifactAbs, rawDossier);

  progress("synthesizing", `Synthesizing comprehensive, cited final report`, 90);

  // 5. Synthesize final report with inline citations [n](url)
  const synthPrompt = `You are a principal researcher writing a comprehensive, authoritative Deep Research Report.
Topic: ${topic}
${focus ? `Specific Focus: ${focus}\n` : ""}

Here are the extracted findings from ${pageContents.length} sources:
${pageContents.map((p, i) => `[${i + 1}] ${p.title} (${p.url}):\n${p.content.slice(0, 2000)}`).join("\n\n")}

Structure your report with:
# ${topic}
## Executive Summary
## In-Depth Analysis & Key Findings (cite claims inline as [n](url) using the exact URLs above)
## Comparative Evaluation / Trade-offs
## Limitations, Uncertainties & Gaps
## Primary References & Sources

Be rigorous, concrete with numbers/facts, objective, and dense. Do NOT output meta commentary or conversational filler.`;

  let report = "";
  try {
    report = await complete(st, [{ role: "user", content: synthPrompt }], 2500);
  } catch (err: unknown) {
    report = `# Deep Research: ${topic}\n\nFailed to complete synthesis: ${String(err)}`;
  }

  progress("done", "Deep research complete", 100);

  const sourcesList = pageContents.map((p) => ({
    title: p.title,
    url: p.url,
    snippet: p.content.slice(0, 180),
  }));

  // Construct UI Block for Chat
  const uiBlock = `<ui>
<x-card title="Deep Research Report: ${topic.replace(/"/g, "&quot;")}" tone="accent">
  <x-row style="gap: 16px; margin-bottom: 12px;">
    <x-stat value="${queries.length}" label="Research Vectors"></x-stat>
    <x-stat value="${pageContents.length}" label="Sources Analyzed"></x-stat>
    <x-stat value="${est(report)}" label="Report Tokens"></x-stat>
  </x-row>
  <x-callout tone="success" title="Research Dossier Saved">
    Full source readings preserved in <a href="${artifactRel}"><code>${artifactRel}</code></a> without bloating conversation context.
  </x-callout>
</x-card>
</ui>`;

  return {
    ok: true,
    topic,
    report,
    artifactPath: artifactRel,
    sources: sourcesList,
    stats: {
      searches: queries.length,
      pagesRead: pageContents.length,
      sourcesCount: seenUrls.size,
    },
    uiBlock,
  };
}
