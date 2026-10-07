import type { Metadata } from "next";
import Summon from "./Summon";

/** The summon window's title — it is also how `minimalist-chat summon` recognises an open one. */
export const metadata: Metadata = { title: "Ask · Workspace", description: "Ask the workspace without leaving what you were doing" };

export default function Page() {
  return <Summon />;
}
