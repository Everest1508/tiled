// HTTP + SSE side of the bridge. The browser page talks to this; the MCP side (server.mjs) uses its methods.
import http from "node:http";
import { randomUUID } from "node:crypto";

const MAX_BODY = 80 * 1024 * 1024;

export function createBridge({ port = 8787, host = "127.0.0.1", origins = [] } = {}) {
  const sse = new Set();
  const jobs = new Map();
  const commands = new Map();
  let snapshot = null;
  const images = new Map(); // tileset id -> { key, data }; the page sends each image only once
  let snapshotAt = 0;
  let server = null;

  const allowedOrigin = (origin) => {
    if (!origin) return true; // not a browser (curl, tests)
    try {
      const u = new URL(origin);
      if (["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return true;
    } catch {
      return false;
    }
    return origins.includes(origin);
  };

  const cors = (req, res) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigin(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "content-type");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      // Chrome asks for this when a public https page talks to localhost.
      res.setHeader("Access-Control-Allow-Private-Network", "true");
      res.setHeader("Access-Control-Max-Age", "600");
    }
  };

  const json = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on("data", (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(new Error("Request too large"));
          req.destroy();
        } else chunks.push(c);
      });
      req.on("end", () => {
        try {
          resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
        } catch {
          reject(new Error("Invalid JSON"));
        }
      });
      req.on("error", reject);
    });

  const broadcast = (event, data) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sse) res.write(msg);
  };

  const publicJob = (j) => ({ id: j.id, type: j.type, status: j.status, message: j.message });

  const handler = async (req, res) => {
    cors(req, res);
    if (req.headers.origin && !allowedOrigin(req.headers.origin)) return json(res, 403, { error: "Origin not allowed. Add it to TILE_STUDIO_ORIGINS." });
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }
    const url = new URL(req.url, "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return json(res, 200, { ok: true, app: "tile-studio-bridge", version: 1, pageConnected: sse.size > 0 });
      }
      if (req.method === "GET" && url.pathname === "/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        res.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);
        sse.add(res);
        const ka = setInterval(() => res.write(": keepalive\n\n"), 15000);
        req.on("close", () => {
          clearInterval(ka);
          sse.delete(res);
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/state") {
        const b = await readBody(req);
        for (const t of Array.isArray(b.tilesets) ? b.tilesets : []) {
          if (t.annotated) images.set(t.id, { key: t.imgKey, data: t.annotated });
          const known = images.get(t.id);
          t.annotated = known && known.key === t.imgKey ? known.data : undefined;
        }
        snapshot = b;
        snapshotAt = Date.now();
        return json(res, 200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/jobs") {
        const b = await readBody(req);
        if (!b.type || typeof b.prompt !== "string") return json(res, 400, { error: "type and prompt are required" });
        const job = { id: randomUUID().slice(0, 8), type: String(b.type), prompt: b.prompt, image: b.image ?? null, meta: b.meta ?? {}, status: "queued", message: "" };
        jobs.set(job.id, job);
        broadcast("job_update", publicJob(job));
        return json(res, 200, { id: job.id });
      }
      let m = /^\/jobs\/([\w-]+)\/cancel$/.exec(url.pathname);
      if (req.method === "POST" && m) {
        const job = jobs.get(m[1]);
        if (!job) return json(res, 404, { error: "Unknown job" });
        if (job.status === "queued" || job.status === "running") {
          job.status = "cancelled";
          broadcast("job_update", publicJob(job));
        }
        return json(res, 200, { ok: true });
      }
      m = /^\/commands\/([\w-]+)\/result$/.exec(url.pathname);
      if (req.method === "POST" && m) {
        const pending = commands.get(m[1]);
        if (pending) {
          commands.delete(m[1]);
          pending.resolve(await readBody(req));
        }
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: "Not found" });
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  };

  return {
    get snapshot() { return snapshot; },
    get snapshotAt() { return snapshotAt; },
    get pageConnected() { return sse.size > 0; },
    get port() { return server?.address()?.port ?? port; },

    listen() {
      return new Promise((resolve, reject) => {
        server = http.createServer(handler);
        server.once("error", reject);
        server.listen(port, host, () => resolve(server.address().port));
      });
    },
    close() {
      for (const res of sse) res.end();
      sse.clear();
      return new Promise((r) => (server ? server.close(() => r()) : r()));
    },

    /** Asks the page to do something and waits for its answer. */
    sendCommand(type, payload, timeoutMs = 20000) {
      if (sse.size === 0) return Promise.reject(new Error("Tile Map Studio is not connected. Open the page and choose Claude Code in Settings."));
      const id = randomUUID().slice(0, 8);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          commands.delete(id);
          reject(new Error("The page did not answer in time."));
        }, timeoutMs);
        commands.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); } });
        broadcast("command", { id, type, payload });
      });
    },

    /** Long-poll for the next queued job. */
    async nextJob(waitMs) {
      const deadline = Date.now() + waitMs;
      for (;;) {
        for (const job of jobs.values()) {
          if (job.status === "queued") {
            job.status = "running";
            broadcast("job_update", publicJob(job));
            return job;
          }
        }
        if (Date.now() >= deadline) return null;
        await new Promise((r) => setTimeout(r, 250));
      }
    },

    finishJob(id, { message = "", error = "" } = {}) {
      const job = jobs.get(id);
      if (!job) return { ok: false, text: `No job with id ${id}.` };
      if (job.status === "cancelled") return { ok: true, text: "That job was cancelled by the user. Nothing more to do." };
      job.status = error ? "failed" : "done";
      job.message = error || message;
      broadcast("job_update", publicJob(job));
      return { ok: true, text: "Job finished." };
    },

    jobCounts() {
      const c = { queued: 0, running: 0 };
      for (const j of jobs.values()) if (j.status in c) c[j.status]++;
      return c;
    },
  };
}
