import fs from "fs/promises";
import path from "path";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages, type Part } from "@/db/schema";
import { WS, ensureWorkspace } from "./workspace";
import { chatDir } from "./shared";

type Conv = typeof conversations.$inferSelect;
type Emit = (event: Record<string, unknown>) => void;
type ResearchPart = Extract<Part, { type: "research" }>;

type Options = {
  conv: Conv;
  assistantId: string;
  parentId: string;
  threadOf: string | null;
  emit: Emit;
  signal: AbortSignal;
  takeSteers?: () => string[];
  request: string;
  followup?: boolean;
};

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const blockSource = `<ui>
<x-section title="Local UI smoke test" subtitle="Deterministic fixture · no model API key"></x-section>
<x-row>
  <x-stat value="18" label="Simulated tool calls"></x-stat>
  <x-stat value="3" label="Demo sources"></x-stat>
</x-row>
<x-progress value="5" max="5" label="Research stages"></x-progress>
<x-mermaid>flowchart LR
  A["/test"] --> B["Simulated tools"]
  B --> C["Blocks and flowchart"]
  C --> D["Queue or steer"]
  D --> E["Saved run details"]
</x-mermaid>
<x-chart type="bar" labels="Files|Search|Fetch|Blocks" series="Coverage" data="2,1,3,4" title="Demo coverage"></x-chart>
<x-card title="Try an inline interaction">
  <x-choice name="smoke_pick" options="Cards|Flowchart|Both" answer="Both" reveal></x-choice>
</x-card>
<x-timer id="smoke_timer" seconds="10"></x-timer>
<button @click="smoke_timer.toggle()">Start or pause the 10-second timer</button>
</ui>`;

const chapters: [string, string][] = [
  ["Streaming and scroll position", "This report is intentionally delivered in small chunks. Watch the answer grow, then try typing while it streams: the composer should stay steady rather than resizing on every keystroke. When you open this conversation later, the message list should land at the newest response, not at an old scroll offset."],
  ["Tool-call-local progress", "Each row below is a simulated tool event, not a call to the filesystem, browser, network, shell, or a model. Expand the rows to inspect their own progress and result. File reads show readable text, writes and edits show before-and-after diffs, shell and Python show streamed output, and search/fetch keep their source cards inside their tool call."],
  ["Search and source cards", "The search cards use reserved example domains and explicitly fictional snippets. They are here to check the compact source-card layout, link affordance, source label, snippets, and corner radius. They do not claim to report real search results, and the test itself makes no outbound requests."],
  ["Parallel page reading", "The parallel-fetch row contains several independent mock pages. It streams one completion line per page; expand the row to see source cards and fetched excerpts. In a real research turn, direct HTTP is attempted first and any configured Firecrawl service remains a fallback rather than the default retrieval path."],
  ["Blocks and flowcharts", "The inline BlocksUI gallery below combines a stage diagram, a chart, a selectable choice, and a timer. It is safe to interact with those components: none of them submit data or contact a model. The same gallery is opened in a docked canvas so you can compare inline rendering with a persistent canvas."],
  ["The PDF fixture", "A tiny three-page PDF is created in this chat's own artifact folder. Page two has a 90-degree rotation, and all three pages contain visible text. Open it from the floating test canvas or Artifacts to check page navigation, rotation, sizing, and whether a page turns blank after a resize."],
  ["Research stages and details", "The progress card is a simulated deep-research run. It advances through framing, search, source inspection, cross-checking, and synthesis. Its Run details button opens a JSON record saved in this chat folder; intermediate tool history is available there without being fed into later ordinary chat turns."],
  ["Queue and steer", "While this long response is running, send a normal message to queue it for after the demo, or use Alt+Enter to send a live direction. The test stream acknowledges live directions locally. Queued messages from this run are marked as test follow-ups, so they receive a short local mock reply instead of failing because no model key is configured."],
  ["Keyboard and mouse", "The same navigation works with a pointer or keyboard. Try the Chats, Workspace, and Artifacts panels, then use the arrow keys and Enter in their search/list controls. Slash commands and file/chat mentions stay in the composer; selecting /test from the slash menu starts this same local stream."],
  ["Prompt and memory recovery", "Prompt-default restore controls are available from Workspace. They restore one shipped instruction or skill, or all shipped defaults, and keep a rollback path. Memory edits and forget actions also have recovery controls. This smoke test does not mutate prompts or memory, so those controls remain safe to explore separately."],
  ["Drop and canvas behavior", "A file dropped over the chat is saved in this chat's uploads; a file dropped on the composer is attached. The overlay should disappear on drop or drag cancellation. On wide screens, the Blocks canvas occupies the dock and the PDF canvas opens floating because that dock is already in use."],
  ["General mode and retrieval", "The app's general mode is conversational and does not search by default. This response is a local fixture, not evidence that web search works. The actual web tools are only used when helpful; /research is the staged research workflow, and its final report remains in normal chat context while intermediate run details remain inspectable."],
  ["Setup and optional services", "The install/update flow prefers an ordinary OpenAI-compatible endpoint and embedded PGlite. FreeLLMAPI and Firecrawl are optional Docker services. Firecrawl is an explicitly configured fallback, while direct HTTP and fast keyless search are tried first. This command does not install, update, or bind any service."],
  ["Accessibility and reliability", "The cards use visible labels, sensible tool names, keyboard-operable buttons, and explicit result states. Try reducing the window width, opening and closing the dock, and stopping the stream midway. Stop should preserve the partial response and mark the research fixture as stopped rather than leaving a spinner behind."],
  ["What is real and what is simulated", "Only this assistant response and the small test artifacts in this chat's folder are created. Tool rows, sources, integration results, process output, and research counts are fixtures. No shell command is executed; no URL is fetched; no prompt or memory note is edited; no outside API key is read."],
  ["Finishing the smoke test", "After the stream ends, inspect the tool results, expand the Block gallery, try the timer and choice, open the saved PDF and flowchart canvas, and review the research details. If a panel or card is empty, note which one: that helps distinguish an animation issue from missing demo data."],
];

const makeLongReport = (pdfPath: string, notePath: string, detailsPath: string) => [
  "# Local UI smoke test",
  "This is a deterministic, server-streamed demonstration. It works without an LLM API key. Tool calls and research are simulated; only the small test artifacts in this chat's folder are written.",
  "## What this run exercises",
  "Plan updates · file read/write/edit/search · web search cards · parallel fetch excerpts · MCP and skill labels · shell/Python output · browser result · quality check · staged research · BlocksUI · Mermaid flowchart · docked canvas · rotated PDF · queue and steer.",
  ...chapters.map(([title, body], i) => `### ${String(i + 1).padStart(2, "0")} · ${title}\n\n${body}\n\nFor this pass, the important thing is to watch the interface change as events arrive. The report is long on purpose: it gives you time to inspect a tool card, resize a panel, or interact with the composer without requiring any network request.`),
  "## Artifact paths",
  `- Demo note: \`${notePath}\``,
  `- Rotated PDF: \`${pdfPath}\``,
  `- Research details: \`${detailsPath}\``,
  "## Markdown, code, and math",
  "A table and a code block help check ordinary rendering alongside the BlocksUI language:",
  "| Surface | Expected behavior |\n|---|---|\n| Tool card | Progress and result stay inside the call |\n| BlocksUI | Flowchart and controls render in chat and canvas |\n| PDF | Three pages; page two is rotated |\n| Queue | Follow-up receives a local mock reply |",
  "```ts\ntype DemoResult = { simulated: true; apiKeyRequired: false };\nconst result: DemoResult = { simulated: true, apiKeyRequired: false };\n```",
  "Inline math should remain readable: $a^2 + b^2 = c^2$. The report itself is plain Markdown; the interactive gallery is the `<ui>` block below.",
  blockSource,
  "## Demo sources (not research evidence)",
  "The cards above use reserved example URLs solely to exercise source rendering. They are not sources for the statements in this fixture. A real deep-research response should cite only pages it actually opened and should state any unresolved coverage gaps.",
  "## End of long stream",
  "If this final line arrived after the earlier sections without a jump, the streaming pass completed. The saved answer remains available in chat history; the generated artifacts remain in the current chat's workspace folder.",
].join("\n\n");

/** Build a tiny valid PDF with three text pages; the middle page is intentionally rotated 90 degrees. */
function makeRotatedPdf() {
  const streams = [
    "BT /F1 24 Tf 72 700 Td (PDF UI smoke test - page 1 of 3) Tj 0 -34 Td /F1 13 Tf (Portrait page; test navigation and text selection.) Tj ET\n",
    "BT /F1 24 Tf 70 500 Td (Rotated page 2 of 3) Tj 0 -32 Td /F1 13 Tf (This page uses the PDF Rotate entry.) Tj ET\n",
    "BT /F1 24 Tf 72 700 Td (PDF UI smoke test - page 3 of 3) Tj 0 -34 Td /F1 13 Tf (The final page should remain visible after resizing.) Tj ET\n",
  ];
  const streamObj = (s: string) => `<< /Length ${Buffer.byteLength(s, "ascii")} >>\nstream\n${s}endstream`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 8 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Rotate 90 /Resources << /Font << /F1 8 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 8 0 R >> >> /Contents 9 0 R >>",
    streamObj(streams[0]), streamObj(streams[1]),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    streamObj(streams[2]),
  ];
  let pdf = "%PDF-1.4\n%âãÏÓ\n";
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf, "latin1")); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

export async function runUiTest(opts: Options) {
  const { conv, assistantId, parentId, threadOf, emit, signal } = opts;
  await ensureWorkspace();
  const parts: Part[] = [];
  const textPart = () => {
    const last = parts[parts.length - 1];
    if (last?.type === "text") return last;
    const next: Extract<Part, { type: "text" }> = { type: "text", text: "" };
    parts.push(next); return next;
  };
  const pushVisible = (text: string) => {
    if (!text || signal.aborted) return;
    textPart().text += text;
    emit({ t: "text", d: text });
  };
  let chunkCount = 0;
  const acceptSteers = () => {
    for (const direction of (opts.takeSteers?.() || [])) {
      parts.push({ type: "steer", text: direction });
      const safe = direction.replace(/[\r\n]+/g, " ").slice(0, 240);
      pushVisible(`\n\n> The local stream received your live direction: “${safe}”\n\n`);
    }
  };
  const streamText = async (text: string, slow = true) => {
    const chars = Array.from(text);
    for (let i = 0; i < chars.length && !signal.aborted; i += 20) {
      pushVisible(chars.slice(i, i + 20).join(""));
      if (++chunkCount % 7 === 0) acceptSteers();
      if (slow) await pause(30);
    }
    acceptSteers();
  };

  let callNo = 0;
  const fakeTool = async (name: string, args: Record<string, unknown>, result: string, config: { meta?: unknown; stage?: string; output?: string; ok?: boolean } = {}) => {
    if (signal.aborted) return false;
    const id = `test_${assistantId}_${++callNo}`;
    const part: Extract<Part, { type: "tool" }> = { type: "tool", id, name, args };
    parts.push(part);
    emit({ t: "toolStart", id, name });
    emit({ t: "tool", id, name, args });
    emit({ t: "toolProgress", id, text: config.stage || `Preparing a local ${name.replace(/_/g, " ")} demo…` });
    if (config.output) {
      for (let i = 0; i < config.output.length && !signal.aborted; i += 24) {
        const chunk = config.output.slice(i, i + 24);
        part.live = (part.live || "") + chunk;
        emit({ t: "toolOutput", id, chunk });
        await pause(55);
      }
    } else await pause(120);
    part.result = signal.aborted ? "(stopped by the user)" : result;
    part.ok = signal.aborted ? false : config.ok !== false;
    if (config.meta) part.meta = config.meta;
    emit({ t: "toolResult", id, result: part.result, ok: part.ok, meta: part.meta });
    return !signal.aborted;
  };

  const demoDir = `${chatDir(conv.id)}/artifacts/ui-smoke`;
  const notePath = `${demoDir}/demo-note.md`;
  const uiPath = `${demoDir}/blocks-gallery.ui`;
  const pdfPath = `${demoDir}/rotated-pages.pdf`;
  const detailsPath = `${chatDir(conv.id)}/research/${assistantId}.json`;
  const stages: ResearchPart["stages"] = [
    { id: "frame", label: "Frame the question", status: "doing" },
    { id: "search", label: "Search for sources", status: "todo" },
    { id: "inspect", label: "Read pages in parallel", status: "todo" },
    { id: "verify", label: "Cross-check findings", status: "todo" },
    { id: "synthesize", label: "Write the final report", status: "todo" },
  ];
  const researchPart: ResearchPart = { type: "research", status: "running", stages, searches: 0, pages: 0, sources: 0 };
  const updateResearch = () => emit({ t: "research", research: { ...researchPart, stages: researchPart.stages.map((s) => ({ ...s })) } });
  const stage = (id: string) => {
    const index = researchPart.stages.findIndex((s) => s.id === id);
    if (index < 0) return;
    researchPart.stages = researchPart.stages.map((s, i) => ({ ...s, status: i < index ? "done" : i === index ? "doing" : "todo" }));
    updateResearch();
  };

  if (opts.followup) {
    await fakeTool("fs_read", { path: notePath }, "# UI test note\nThis file was created by /test inside this chat's artifacts folder.\n", { stage: "Reading the local smoke-test artifact…" });
    await streamText("## Queued test follow-up\n\nYour queued message arrived after the long local smoke test. This short response is also simulated, so it works without a model key. The queue item was linked after the previous assistant message; it was not sent to an LLM.\n\nThe test follow-up is complete. You can queue another message while this response is running, or send a live direction with Alt+Enter.\n");
  } else {
    parts.push(researchPart); updateResearch();
    await streamText("# Local UI smoke test\n\nThis is a deterministic, server-streamed demo. It works **without an LLM API key**. The tool rows and sources below are fixtures; no external tool or model is called.\n\n");
    await fakeTool("todo", { items: [{ text: "Stream a long response", status: "doing" }, { text: "Show simulated tool calls", status: "todo" }, { text: "Render Blocks and flowcharts", status: "todo" }, { text: "Save a rotated PDF and run details", status: "todo" }] }, "Plan set: stream a long response, simulate tool results, render Blocks, and save inspectable demo artifacts.", {
      meta: { todo: [{ text: "Stream a long response", status: "doing" }, { text: "Show simulated tool calls", status: "todo" }, { text: "Render Blocks and flowcharts", status: "todo" }, { text: "Save a rotated PDF and run details", status: "todo" }] },
      stage: "Creating the local UI smoke-test plan…",
    });
    await streamText("## Files and diffs\n\nThe next calls create a note, read it back, and apply a small edit. Expand each row to inspect the result; click its path to open the real demo artifact.\n\n");
    const noteBefore = "";
    const noteBeforeEdit = "# UI test note\nThis file was created by the local /test command.\nIt contains no user data.\n";
    const noteAfterEdit = noteBeforeEdit + "Use the Artifacts panel to open the accompanying Blocks gallery and rotated PDF.\n";
    if (!signal.aborted) {
      await fs.mkdir(path.join(WS, demoDir), { recursive: true });
      await fs.writeFile(path.join(WS, notePath), noteBeforeEdit, "utf8");
      emit({ t: "artifact", path: notePath });
    }
    await fakeTool("fs_write", { path: notePath, content: noteBeforeEdit }, `Wrote ${notePath} (3 lines)`, { meta: { path: notePath, before: noteBefore, after: noteBeforeEdit }, stage: "Creating the note in this chat's demo-artifacts folder…" });
    await fakeTool("fs_read", { path: notePath }, noteBeforeEdit.split("\n").map((line, i) => `${i + 1}\t${line}`).join("\n"), { stage: "Reading the saved note and preparing a readable excerpt…" });
    if (!signal.aborted) await fs.writeFile(path.join(WS, notePath), noteAfterEdit, "utf8");
    await fakeTool("fs_edit", { path: notePath, find: "It contains no user data.", replace: "It contains no user data and can be deleted with this chat." }, `Edited ${notePath}`, { meta: { path: notePath, before: noteBeforeEdit, after: noteAfterEdit }, stage: "Applying the edit and checking the before/after diff…" });
    await fakeTool("fs_search", { path: demoDir, pattern: "Blocks" }, `${notePath}:4:Use the Artifacts panel to open the accompanying Blocks gallery and rotated PDF.\n1 match in 1 file`, { stage: "Searching the chat's demo artifacts…" });

    await streamText("## Simulated web retrieval\n\nThese reserved example-domain cards test source layout only. The fetch row also includes independent excerpts and a progress counter.\n\n");
    stage("search"); researchPart.searches = 1; updateResearch();
    const sources = [
      { url: "https://example.com/", title: "Example Domain · mock search result", snippet: "Reserved example page used only to test source-card rendering." },
      { url: "https://example.org/", title: "Example Organization · mock search result", snippet: "Reserved example domain used only to test source-card rendering." },
      { url: "https://example.net/", title: "Example Network · mock source card", snippet: "Reserved example domain used only to test links and snippets." },
    ];
    await fakeTool("web_search", { query: "UI smoke-test example sources", limit: 3 }, "3 fixture results (no web request was made).", { meta: { sources, source: "fast" }, stage: "Searching (simulated); opening the source-card layout…" });
    stage("inspect"); researchPart.pages = 3; updateResearch();
    const excerpts = sources.map((s, i) => `## ${s.title}\n${s.url}\n\nMock excerpt ${i + 1}: ${s.snippet}`).join("\n\n---\n\n");
    await fakeTool("web_fetch_many", { urls: sources.map((s) => s.url) }, excerpts, { meta: { sources, source: "fetch" }, stage: "Fetching 3 pages in parallel (simulated)…", output: "Read 1 of 3 pages…\nRead 2 of 3 pages…\nRead 3 of 3 pages…\n" });

    await streamText("## Integrations, skills, and command output\n\nThe following rows are also fixtures: no MCP server, skill loader, browser, shell, or Python interpreter is invoked. They let you inspect the labels and result formatting without enabling access or installing anything.\n\n");
    stage("verify");
    await fakeTool("mcp__demo__list_records", { filter: "smoke test", limit: 2 }, JSON.stringify({ status: "simulated", records: [{ name: "Fixture alpha", state: "ready" }, { name: "Fixture beta", state: "ready" }] }), { stage: "Waiting for a simulated MCP integration…" });
    await fakeTool("skill_open", { name: "blocks" }, "Blocks skill preview\n\nUse <ui> with a concise component composition. This fixture is shown as a tool result; the skill is not loaded from disk.", { stage: "Opening a simulated skill preview…" });
    await fakeTool("shell", { command: "printf 'local UI test only\\n'" }, "local UI test only\n", { stage: "Running a simulated safe command…", output: "local UI test only\n" });
    await fakeTool("run_python", { code: "sum([2, 3, 5])" }, "10\n", { stage: "Running a simulated Python snippet…", output: "10\n" });
    await fakeTool("browser", { target: "https://example.com/" }, "Simulated browser result: example page title, screenshot placeholder, and no console errors. No browser was launched.", { stage: "Opening a simulated browser result…" });
    const uiFile = blockSource.replace(/^<ui>\s*/, "").replace(/\s*<\/ui>$/, "");
    if (!signal.aborted) {
      const pdf = makeRotatedPdf();
      await fs.writeFile(path.join(WS, pdfPath), pdf);
      await fs.writeFile(path.join(WS, uiPath), uiFile, "utf8");
      emit({ t: "artifact", path: pdfPath }); emit({ t: "artifact", path: uiPath });
    }
    await fakeTool("fs_write", { path: pdfPath, content: "3-page PDF fixture; page 2 rotated 90 degrees." }, `Created ${pdfPath} · 3 pages · page 2 rotated 90°`, { meta: { path: pdfPath }, stage: "Creating a tiny, valid rotated-page PDF fixture…" });
    await fakeTool("fs_write", { path: uiPath, content: "Blocks gallery fixture with Mermaid flowchart, chart, choice, and timer." }, `Created ${uiPath}`, { meta: { path: uiPath }, stage: "Saving the Blocks gallery artifact…" });
    await fakeTool("quality_check", { files: [notePath, uiPath, pdfPath] }, "Passed · fixture artifacts and UI sections are present. This is a demo status, not a real lint run.", { stage: "Checking the simulated demo checklist…" });
    if (await fakeTool("canvas_open", { target: uiPath, title: "/test · Blocks gallery", dock: true }, "Opened the Blocks gallery in the empty sidebar.", { stage: "Opening the Blocks gallery in a docked canvas…" })) {
      emit({ t: "canvas", spec: { kind: "ui", title: "/test · Blocks gallery", source: uiFile, path: uiPath }, dock: true });
    }
    if (await fakeTool("canvas_open", { target: pdfPath, title: "/test · Rotated PDF", dock: true }, "Opened the PDF in a floating canvas because the sidebar already contains the Blocks gallery.", { stage: "Opening the rotated PDF beside the occupied sidebar…" })) {
      emit({ t: "canvas", spec: { kind: "file", title: "/test · Rotated PDF", path: pdfPath }, dock: true });
    }

    stage("synthesize");
    const report = makeLongReport(pdfPath, notePath, detailsPath);
    await streamText("## Staged report\n\nThe final section is deliberately long. Queue another message or use Alt+Enter to steer while it arrives; this local stream will acknowledge directions and will not contact a model.\n\n");
    await streamText(report);
    if (!signal.aborted) await fakeTool("todo", { items: [{ text: "Stream a long response", status: "done" }, { text: "Show simulated tool calls", status: "done" }, { text: "Render Blocks and flowcharts", status: "done" }, { text: "Save a rotated PDF and run details", status: "done" }] }, "All smoke-test phases are complete.", {
      meta: { todo: [{ text: "Stream a long response", status: "done" }, { text: "Show simulated tool calls", status: "done" }, { text: "Render Blocks and flowcharts", status: "done" }, { text: "Save a rotated PDF and run details", status: "done" }] },
      stage: "Completing the local demo checklist…",
    });
  }

  const status = signal.aborted ? "stopped" : "done";
  if (opts.followup) {
    // The queued response is also local, but it does not pretend to be a research run.
  } else {
    researchPart.status = status;
    if (status === "done") researchPart.stages = researchPart.stages.map((s) => ({ ...s, status: "done" }));
    else researchPart.stages = researchPart.stages.map((s) => s.status === "doing" ? { ...s, status: "todo" } : s);
    const urlSet = new Set(["https://example.com/", "https://example.org/", "https://example.net/"]);
    researchPart.sources = urlSet.size;
    researchPart.path = detailsPath;
    const finalReport = parts.filter((p): p is Extract<Part, { type: "text" }> => p.type === "text").map((p) => p.text).join("");
    const toolParts = parts.filter((p): p is Extract<Part, { type: "tool" }> => p.type === "tool");
    try {
      await fs.mkdir(path.dirname(path.join(WS, detailsPath)), { recursive: true });
      await fs.writeFile(path.join(WS, detailsPath), JSON.stringify({
        version: 1, id: assistantId, conversationId: conv.id, status, fake: true,
        startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
        request: opts.request.replace(/^\/test\s*/i, ""), stages: researchPart.stages,
        stats: { searches: researchPart.searches, pages: researchPart.pages, sources: researchPart.sources },
        tools: toolParts, finalReport,
      }, null, 2));
      emit({ t: "artifact", path: detailsPath });
    } catch (e) {
      emit({ t: "error", text: `Could not save local test details: ${e instanceof Error ? e.message : String(e)}` });
    }
    updateResearch();
  }

  const content = parts.filter((p): p is Extract<Part, { type: "text" }> => p.type === "text").map((p) => p.text).join("");
  await db.insert(messages).values({ id: assistantId, conversationId: conv.id, parentId, threadOf, role: "assistant", content, parts });
  await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conv.id));
  const fresh = await db.select().from(messages).where(eq(messages.conversationId, conv.id));
  const dir = path.join(WS, chatDir(conv.id));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "chat.json"), JSON.stringify({ conversation: conv, messages: fresh }, null, 1)).catch(() => {});
  await fs.rm(path.join(WS, "chats", `${conv.id}.json`), { force: true }).catch(() => {});
}
