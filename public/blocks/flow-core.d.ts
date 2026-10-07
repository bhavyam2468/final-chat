export type FlowNode = { id: string; label: string; kind: "step" | "decision" | "terminal" };
export type FlowEdge = { id: string; from: string; to: string; label?: string };
export type FlowGraph = { nodes: FlowNode[]; edges: FlowEdge[]; direction: string };
declare const flow: {
  parse(source: string, preferredDirection?: string): FlowGraph;
  validate(graph: unknown, preferredDirection?: string): FlowGraph;
  limits: { nodes: number; edges: number; label: number; source: number };
};
export default flow;
