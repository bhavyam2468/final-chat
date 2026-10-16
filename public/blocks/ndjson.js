/* Shared incremental backend framing for the app bridge and Blocks playground. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BlocksNDJSON = api;
})(globalThis, function () {
  async function readNDJSON(stream, onEvent, maxRecord = 3_000_000) {
    const reader = stream.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
    let buffer = "";
    const consume = (line) => {
      if (!line.trim()) return;
      if (line.length > maxRecord) throw new Error("Backend record exceeds the size limit");
      const event = JSON.parse(line);
      if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("Invalid backend event");
      onEvent(event);
    };
    try {
      for (;;) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let end;
        while ((end = buffer.indexOf("\n")) !== -1) { consume(buffer.slice(0, end)); buffer = buffer.slice(end + 1); }
        if (buffer.length > maxRecord) throw new Error("Backend record exceeds the size limit");
        if (done) { consume(buffer); break; }
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
  }
  return { readNDJSON };
});
