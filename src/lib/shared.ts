/** Pure helpers shared by server and client code. */
export const canvasSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "canvas";
/** Artifact path a <canvas title> is saved to: Blocks UIs -> .ui, anything else (markdown, media, embeds) -> .md */
/** Each chat owns a folder: chat.json (the conversation), artifacts/ (what was built in it), uploads/ (its attachments). */
export const chatDir = (convId: string) => `chats/${convId}`;
export const canvasPath = (title: string, body: string, convId?: string) => `${convId ? chatDir(convId) + "/" : ""}artifacts/${canvasSlug(title)}.${/<ui[\s>]/.test(body) ? "ui" : "md"}`;
export const youtubeId = (u: string) => u.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/)?.[1];
