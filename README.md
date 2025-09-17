# Hypermedia Starter (Bun + Fixi + KitaJS HTML)

This is a minimal, production-style starter for building hypermedia apps:

- Backend: Bun.serve routes
- Rendering: Server-side JSX to HTML strings via `@kitajs/html`
- Frontend: Lightweight hypermedia via `fixi.js` (vendored locally)

It demonstrates the core hypermedia loop with a simple counter and a live event log:

- A button submits to the server, which returns an HTML patch that Fixi swaps into the page.
- A server-sent events (SSE) stream appends log entries as changes happen.
- No‑JS fallback uses PRG (Post/Redirect/Get) for clean refresh/back behavior.

Use this as a tutorial and baseline to build upon.

**References**
- [Hypertext (Wikipedia)](https://en.wikipedia.org/wiki/Hypertext)
- [HATEOAS (Wikipedia)](https://en.wikipedia.org/wiki/HATEOAS)
- [Hypermedia Systems](https://hypermedia.systems/)
- [DataStar](https://data-star.dev/)
- [htmx](https://htmx.org/)
- [Fixi (GitHub)](https://github.com/bigskysoftware/fixi)

**Why Hypermedia?**
- Server renders HTML. Client stays “dumb”, only handling fetch + swap.
- State and logic live server-side. No client framework needed.
- Progressive enhancement: works with and without JS.

**Run (dev with HMR)**
- Install deps: `bun install`
- Start: `bun run dev`
- Visit: `http://localhost:4420`
- Change `package.json -> scripts.dev` to adjust the port.

**Stack**
- `Bun.serve` for routing and HTTP
- `@kitajs/html` to render server-side JSX to strings
- `fixi.js` vendored in `public/fixi/` with a small extension for SSE

---

**What You’ll See**
- Counter block with an “Increment” button
  - With JS: Fixi intercepts the form submit, server returns a fragment (HTML for the counter), Fixi swaps it into `#counter`.
  - Without JS: normal form POST to `/counter` returns `303 See Other` → `/` (PRG). The refreshed page shows updated state.
- Log section that streams events
  - Server maintains an in‑memory log
  - With JS: the page auto-connects to `/events` (SSE) and appends log entries live
  - Without JS: the same log is fully rendered on the initial page load

---

**Project Structure**
- `index.tsx` — Bun.serve server and routes
  - `/` full page render
  - `/counter` increment route (AJAX fragment or PRG)
  - `/events` SSE stream (broadcasts log updates)
  - `/static/*` serves vendored assets (Fixi + extension)
- `src/views.tsx` — Server-only JSX components using `@kitajs/html`
  - `Layout` — HTML skeleton, loads Fixi + extension
  - `Counter` — form with Fixi attributes (+ no‑JS action/method)
  - `EventLog` — SSR log plus a declarative autostart element for SSE
- `public/fixi/fixi.js` — vendored Fixi (no dependency, tiny)
- `public/fixi/extensions.js` — custom Fixi extension for SSE:
  - `ext-fx-sse-autostart` auto-opens `EventSource` to `/events`
  - Listens for `event: fixi` JSON payloads `{ target, swap, text }`
  - Swaps patches into the DOM with view transitions when available

---

**Hypermedia Basics in This Starter**
- Fixi Attributes Used
  - `fx-action` — URL to request
  - `fx-method` — HTTP method (e.g., `post`)
  - `fx-target` — CSS selector of element to update
  - `fx-swap` — how to insert (`outerHTML`, `innerHTML`, or position like `beforeend`)
  - `fx-trigger` — event to trigger the request (not needed on form submit)

- No‑JS Fallback
  - The same form includes standard `action` and `method` attributes
  - Server uses PRG: returns `303 See Other` to `/` to avoid resubmission prompts

- SSE Log
  - Page includes `<div ext-fx-sse-autostart="/events" data-target="#event-log" data-swap="beforeend"></div>`
  - The extension opens `EventSource('/events')` and swaps each server event into `#event-log`

---

**Security: Escaping Content**
- KitaJS HTML does not escape children by default (attributes are escaped).
- Use the `e` template tag or the `safe` attribute when rendering untrusted content.
- Example (in `Counter`): `
  <span>{e`Count: ${count}`}</span>
  `
- The event log is server-generated HTML. If you ever mix user input, escape or mark safe appropriately.

---

**API Endpoints**
- `GET /` — Full page
- `POST /counter` — Increments the count
  - With `FX-Request: true` header (Fixi): returns counter fragment
  - Without: returns `303 See Other` to `/` (PRG)
- `GET /events` — Server-Sent Events stream emitting `event: fixi` patches
- `GET /static/*` — Serves files from `public/`

---

**How To Extend**
- More Controls
  - Add buttons/inputs with Fixi attributes to hit new routes
  - Return precise HTML fragments for snappy updates
- Enrich SSE
  - Send more event types, target different elements, vary swap strategies
- Persist State
  - Replace in-memory counter/log with `bun:sqlite` for durability across restarts
- Add Tests / Lint
  - Use `@kitajs/ts-html-plugin`’s `xss-scan` in CI to catch unsafe rendering

---

**Troubleshooting**
- Blank page with JS on
  - Check Network tab: ensure `/static/fixi/fixi.js` and `/static/fixi/extensions.js` load
  - Ensure `/events` returns `text/event-stream`
- Port in use
  - Change `PORT` in `package.json` > `scripts.dev`
- Fragment not swapping
  - Confirm `fx-target` and `fx-swap` are correct
  - Inspect server logs (request + patch preview)

---

Happy hypermedia hacking!
