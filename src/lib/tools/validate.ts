/** Validate the JSON-schema subset used by built-in tools. Never coerce strings into booleans/numbers. */
export type Schema = { type?: string | string[]; properties?: Record<string, Schema>; required?: string[]; items?: Schema; enum?: unknown[] };
export function validateArgs(schema: Schema, value: unknown, at = "arguments"): string | null {
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const matches = (t: string) => t === "array" ? Array.isArray(value) : t === "object" ? value !== null && typeof value === "object" && !Array.isArray(value) : t === "number" ? typeof value === "number" && Number.isFinite(value) : typeof value === t;
  if (types.length && !types.some(matches)) return `${at} must be ${types.join(" or ")}`;
  if (schema.enum && !schema.enum.includes(value)) return `${at} must be one of ${schema.enum.join(", ")}`;
  if (Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) { const err = validateArgs(schema.items, value[i], `${at}[${i}]`); if (err) return err; }
  } else if (value !== null && typeof value === "object" && !Array.isArray(value) && schema.properties) {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required || []) if (!(key in obj)) return `${at}.${key} is required`;
    for (const [key, v] of Object.entries(obj)) {
      if (!schema.properties[key]) return `${at}.${key} is not supported; use ${Object.keys(schema.properties).join(", ")}`;
      const err = validateArgs(schema.properties[key], v, `${at}.${key}`); if (err) return err;
    }
  }
  return null;
}
