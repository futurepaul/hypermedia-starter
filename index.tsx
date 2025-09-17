import { Layout, Counter, EventLog, NostrTimeline } from "./src/views.tsx";
import { EventStore, mapEventsToStore } from "applesauce-core";
import { getDisplayName, getProfilePicture, getSeenRelays, mergeRelaySets } from "applesauce-core/helpers";
import { createAddressLoader } from "applesauce-loaders/loaders";
import { onlyEvents, RelayPool } from "applesauce-relay";
import type { NostrEvent } from "nostr-tools";

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

// ---------------------
// Nostr (server-side) shared timeline
// ---------------------
let nostrRelay = process.env.NOSTR_RELAY || "wss://relay.devvul.com";
const nostrEventStore = new EventStore();
const nostrPool = new RelayPool();
const nostrAddressLoader = createAddressLoader(nostrPool, {
  eventStore: nostrEventStore,
  cacheRequest: (filters) => nostrPool.relay("ws://localhost:4869").request(filters),
  lookupRelays: ["wss://purplepag.es/", "wss://index.hzrd149.com/"],
});
nostrEventStore.addressableLoader = nostrAddressLoader;
nostrEventStore.replaceableLoader = nostrAddressLoader;

let nostrSubCleanup: null | (() => void) = null;
const nostrProfileSubs = new Map<string, any>();
const nostrNotes: Array<{ id: string; html: string }> = [];
const NOSTR_MAX_WINDOW = 20;

function escapeHtml(s: any) {
  return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttr(s: any) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const IMG_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif"]);
const VID_EXT = new Set(["mp4", "webm", "mov", "m4v", "ogg"]);

function sanitizeUrl(raw: string): string | null {
  try {
    let u = raw.trim();
    // strip common trailing punctuation
    while (/[,)!?;:'\]\"]$/.test(u)) u = u.slice(0, -1);
    const url = new URL(u);
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
    return null;
  } catch {
    return null;
  }
}

function renderContentWithMedia(content: string): string {
  const re = /https?:\/\/[^\s<>\"]+/g;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const start = m.index;
    const end = re.lastIndex;
    const urlRaw = m[0];
    out += escapeHtml(content.slice(last, start));
    last = end;
    const safeUrl = sanitizeUrl(urlRaw);
    if (!safeUrl) {
      out += escapeHtml(urlRaw);
      continue;
    }
    const pathname = (() => { try { return new URL(safeUrl).pathname; } catch { return safeUrl; } })();
    const ext = pathname.split(".").pop()?.toLowerCase() || "";
    if (IMG_EXT.has(ext)) {
      out += `<a href="${escapeAttr(safeUrl)}" target="_blank" rel="noopener"><img src="${escapeAttr(safeUrl)}" alt="image" style="max-width:100%;height:auto;border-radius:.25rem"/></a>`;
    } else if (VID_EXT.has(ext)) {
      out += `<video controls preload="metadata" style="max-width:100%;border-radius:.25rem"><source src="${escapeAttr(safeUrl)}"/></video>`;
    } else {
      out += `<a href="${escapeAttr(safeUrl)}" target="_blank" rel="noopener">${escapeHtml(urlRaw)}</a>`;
    }
  }
  out += escapeHtml(content.slice(last));
  return out;
}

function noteHtml(note: NostrEvent, profile?: any) {
  const id = note.id;
  const name = getDisplayName(profile) || note.pubkey.slice(0, 12);
  const avatar = getProfilePicture(profile, `https://robohash.org/${note.pubkey}.png`);
  const content = renderContentWithMedia(note.content ?? "");
  return (
    `<div id="note-${id}" class="nostr-note" style="margin:.5rem 0">` +
    `<div class="note-card" style="border:1px solid #e5e7eb;border-radius:.5rem;box-shadow:0 1px 2px rgba(0,0,0,.05);">` +
    `<div id="note-${id}-header" style="display:flex;gap:.75rem;align-items:center;padding:.75rem .75rem 0 .75rem;">` +
    `<img src="${escapeAttr(avatar)}" alt="Profile" style="width:2.5rem;height:2.5rem;border-radius:9999px;object-fit:cover;"/>` +
    `<strong>${escapeHtml(name)}</strong>` +
    `</div>` +
    `<div style="padding:.5rem .75rem 1rem .75rem;white-space:pre-wrap;">${content}</div>` +
    `</div>` +
    `</div>`
  );
}

function startNostr(relayUrl: string) {
  // Cleanup existing stream
  try { nostrSubCleanup?.(); } catch {}
  for (const [, sub] of nostrProfileSubs) {
    try { sub.unsubscribe?.(); } catch {}
  }
  nostrProfileSubs.clear();

  log("Nostr connect ->", relayUrl);
  // Prime SSR cache with recent history (do NOT broadcast to clients)
  try {
    const backfill: NostrEvent[] = [] as any;
    const req = nostrPool
      .relay(relayUrl)
      .request({ kinds: [1], limit: NOSTR_MAX_WINDOW });
    req.subscribe({
      next: (evt) => backfill.push(evt as NostrEvent),
      error: (err) => log("nostr backfill error", err),
      complete: () => {
        // Sort newest-first and store up to window
        backfill.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
        nostrNotes.length = 0;
        for (const n of backfill.slice(0, NOSTR_MAX_WINDOW)) {
          nostrNotes.push({ id: n.id, html: noteHtml(n, undefined) });
        }
        log("nostr backfill cached:", nostrNotes.length);
      },
    });
  } catch (e) {
    log("nostr backfill failed", e);
  }

  const since = Math.floor(Date.now() / 1000);
  const source = nostrPool
    .relay(relayUrl)
    .subscription({ kinds: [1], since })
    .pipe(
      // Only events (ignore EOSE)
      onlyEvents(),
      // Deduplicate into store
      mapEventsToStore(nostrEventStore),
    );

  const sub = source.subscribe({
    next: (note: NostrEvent) => {
      // Render with whatever profile we have right now
      const user = { pubkey: note.pubkey, relays: mergeRelaySets(getSeenRelays(note)) } as any;
      const htmlText = noteHtml(note, undefined);
      broadcastNostr({ target: "#nostr-timeline", swap: "afterbegin", text: htmlText });
      // Cache newest-first and enforce max window
      nostrNotes.unshift({ id: note.id, html: htmlText });
      if (nostrNotes.length > NOSTR_MAX_WINDOW) {
        const removed = nostrNotes.splice(NOSTR_MAX_WINDOW);
        for (const r of removed) {
          // Remove trimmed notes from clients and cleanup subs
          broadcastNostr({ target: `#note-${r.id}`, swap: "outerHTML", text: "" });
          const sub = nostrProfileSubs.get(r.id);
          try { sub?.unsubscribe?.(); } catch {}
          nostrProfileSubs.delete(r.id);
        }
      }
      // Then subscribe to profile to upgrade header when it arrives
      const prof$ = nostrEventStore.profile(user);
      const profSub = prof$.subscribe((profile) => {
        // Only update if note still within window
        const idx = nostrNotes.findIndex((n) => n.id === note.id);
        if (idx >= 0) {
          const updated = noteHtml(note, profile);
          broadcastNostr({ target: `#note-${note.id}`, swap: "outerHTML", text: updated });
          nostrNotes[idx] = { id: note.id, html: updated };
        } else {
          // No longer visible; drop subscription
          try { nostrProfileSubs.get(note.id)?.unsubscribe?.(); } catch {}
          nostrProfileSubs.delete(note.id);
        }
      });
      nostrProfileSubs.set(note.id, profSub);
    },
    error: (err) => log("nostr error", err),
  });

  nostrSubCleanup = () => {
    try { sub.unsubscribe(); } catch {}
  };
}

// start initial connection
startNostr(nostrRelay);

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
    "/nostr": async (req) => {
      const url = new URL(req.url);
      log(req.method, url.pathname + url.search);
      const initial = nostrNotes.slice(0, 10).map((n) => n.html);
      return html(
        <Layout title="Nostr Timeline">
          <NostrTimeline relay={nostrRelay} initial={initial} />
        </Layout>
      );
    },
    "/nostr/relay": {
      POST: async (req) => {
        const url = new URL(req.url);
        const fxReq = (req.headers.get("fx-request") || req.headers.get("FX-Request") || "").toLowerCase();
        const isFixi = fxReq === "true" || fxReq === "1";
        const form = await req.formData();
        const relay = String(form.get("relay") || "").trim();
        log("set nostr relay ->", relay || "(empty)");
        if (relay) {
          nostrRelay = relay;
          startNostr(nostrRelay);
          // Clear current timeline for connected clients
          broadcastNostr({ target: "#nostr-timeline", swap: "innerHTML", text: "" });
          // Reset server cache and subscriptions
          nostrNotes.length = 0;
          for (const [, sub] of nostrProfileSubs) {
            try { sub.unsubscribe?.(); } catch {}
          }
          nostrProfileSubs.clear();
        }
        if (isFixi) {
          return fragment(
            <div id="nostr-status" style={{ display: 'flex', gap: '.5rem', alignItems: 'center', margin: '.5rem 0 1rem' }}>
              <form
                fx-action="/nostr/relay"
                fx-method="post"
                fx-target="#nostr-status"
                fx-swap="outerHTML"
                action="/nostr/relay"
                method="post"
                style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}
              >
                <label htmlFor="nostr-relay">Relay:</label>
                <input id="nostr-relay" name="relay" size={40} value={nostrRelay} />
                <button type="submit">Set</button>
                <span style={{ opacity: .7 }}>(shared)</span>
              </form>
            </div>
          );
        }
        return Response.redirect("/nostr", 303);
      },
    },
    "/nostr/events": (req) => {
      const url = new URL(req.url);
      log(req.method, url.pathname + url.search, "(open nostr events)");
      const headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      };
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const client = (chunk: Uint8Array) => controller.enqueue(chunk);
          nostrSseClients.add(client);
          controller.enqueue(ENC.encode(": connected\n\n"));
        },
      });
      return new Response(stream, { headers });
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

// separate SSE pool for nostr timeline
const nostrSseClients = new Set<(chunk: Uint8Array) => void>();
function broadcastNostr(obj: { target: string; swap: string; text: string }) {
  const payload = JSON.stringify(obj);
  const chunk = ENC.encode(`event: fixi\n` + `data: ${payload}\n\n`);
  for (const send of nostrSseClients) {
    try {
      send(chunk);
    } catch {
      nostrSseClients.delete(send);
    }
  }
}
