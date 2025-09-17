import { Layout, Counter, EventLog } from "./src/views.tsx";

let count = 0;
let nextId = 1;
const eventLog: Array<{ id: number; text: string }> = [];

function pushEvent(text: string) {
  const entry = { id: nextId++, text };
  eventLog.push(entry);
  return entry;
}

function log(...args: any[]) {
  console.log(new Date().toISOString(), "-", ...args);
}

function html(content: any, init?: ResponseInit): Response {
  const body = String(content);
  return new Response(body, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
    ...init,
  });
}

function fragment(content: any, init?: ResponseInit): Response {
  const body = String(content);
  const preview = body.replace(/\s+/g, " ").trim();
  log("Sending HTML patch:", preview);
  return new Response(body, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
    ...init,
  });
}

Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  development: process.env.NODE_ENV !== "production",
  routes: {
    "/": async (req) => {
      const url = new URL(req.url);
      log(req.method, url.pathname + url.search);
      return html(
        <Layout title="Bun + React SSR + fixi.js">
          <h1>Hypermedia Counter</h1>
          <p>
            This example uses server-rendered React and a <code>fixi.js</code> button
            that POSTs to the server. The server responds with an HTML fragment
            that swaps into <code>#counter</code>.
          </p>
          <Counter count={count} />
          <EventLog events={eventLog} />
        </Layout>
      );
    },

    "/counter": {
      POST: async (req) => {
        const url = new URL(req.url);
        const fxReq = (req.headers.get("fx-request") || req.headers.get("FX-Request") || "").toLowerCase();
        const isFixi = fxReq === "true" || fxReq === "1";
        log(req.method, url.pathname + url.search, isFixi ? "(increment, fx)" : "(increment, full)");
        count += 1;
        // Record event and broadcast via SSE
        const entry = pushEvent(`Incremented to <b>${count}</b> @ ${new Date().toLocaleTimeString()}`);
        broadcastFixi({
          target: "#event-log",
          swap: "beforeend",
          text: `<div>${entry.text}</div>`,
        });

        if (isFixi) {
          // Return only the counter block. fixi targets #counter and swaps outerHTML.
          return fragment(<Counter count={count} />);
        }
        // No-JS fallback: PRG (Post/Redirect/Get) to avoid resubmission
        log("PRG redirect -> / (303) after POST /counter");
        return Response.redirect("/", 303);
      },
      GET: async (req) => {
        const url = new URL(req.url);
        const fxReq = (req.headers.get("fx-request") || req.headers.get("FX-Request") || "").toLowerCase();
        const isFixi = fxReq === "true" || fxReq === "1";
        log(req.method, url.pathname + url.search, isFixi ? "(fx)" : "(full)");
        if (isFixi) return fragment(<Counter count={count} />);
        return html(
          <Layout title="Bun + React SSR + fixi.js">
            <h1>Hypermedia Counter</h1>
            <Counter count={count} />
            <EventLog events={eventLog} />
          </Layout>
        );
      },
    },
    "/events": req => {
      const url = new URL(req.url);
      log(req.method, url.pathname + url.search, "(open events)");
      const headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      };
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const client = (chunk: Uint8Array) => controller.enqueue(chunk);
          sseClients.add(client);
          // optional: initial comment to establish stream
          controller.enqueue(ENC.encode(": connected\n\n"));
        },
        cancel() {
          // handled in finally by removing on error write
        },
      });
      return new Response(stream, { headers });
    },
  },
  // Serve static assets under /static/* from ./public and fallback 404
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/static/")) {
      const rel = url.pathname.replace(/^\/static\//, "");
      const path = `public/${rel}`;
      try {
        const file = Bun.file(path);
        if (!(await file.exists())) return new Response("Not Found", { status: 404 });
        log(req.method, url.pathname, "->", path);
        return new Response(file);
      } catch {
        log(req.method, url.pathname, "(static not found)");
        return new Response("Not Found", { status: 404 });
      }
    }
    log(req.method, url.pathname + url.search, "(unmatched)");
    return new Response("Not Found", { status: 404 });
  },
  error(error) {
    console.error(error);
    return new Response("Internal Server Error", { status: 500 });
  },
});

console.log(`Server running on http://localhost:${process.env.PORT ?? 3000}`);

// SSE broadcast machinery
const ENC = new TextEncoder();
const sseClients = new Set<(chunk: Uint8Array) => void>();
function broadcastFixi(obj: { target: string; swap: string; text: string }) {
  const payload = JSON.stringify(obj);
  log("Broadcast fixi:", payload);
  const chunk = ENC.encode(`event: fixi\n` + `data: ${payload}\n\n`);
  for (const send of sseClients) {
    try {
      send(chunk);
    } catch (e) {
      // Drop dead clients on error
      sseClients.delete(send);
    }
  }
}
