declare const ndjson: {
  readNDJSON(stream: ReadableStream<Uint8Array>, onEvent: (event: Record<string, unknown>) => void, maxRecord?: number): Promise<void>;
};
export default ndjson;
