type AttributeRule = { type?: string; enum?: string[]; min?: number; max?: number; exclusiveMin?: number };
export type ElementSpec = { tags: string; usage: string; container?: boolean; void?: boolean; attrs?: Record<string, AttributeRule> };
declare const schema: {
  registry: Record<string, ElementSpec>;
  guides: Record<string, ElementSpec>;
  attributes(source: string): Record<string, string>;
  attributeIssues(tag: string, attrs: Record<string, string>, names?: Set<string>): string[];
  validate(source: string): string[];
};
export default schema;
