// KitaJS HTML runtime is configured via tsconfig; no React on client
import { e } from "@kitajs/html";

export function Layout(props: { title?: string; children?: React.ReactNode }) {
  const { title = "Hypermedia Starter", children } = props;
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <style>{`
          body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica Neue, Arial, "Apple Color Emoji", "Segoe UI Emoji"; line-height: 1.5; margin: 2rem; }
          .counter { display: inline-flex; gap: .75rem; align-items: center; padding: 1rem; border: 1px solid #e5e7eb; border-radius: .5rem; }
          .counter form { display: inline-flex; gap: .75rem; align-items: center; margin: 0; }
          button { padding: .5rem .75rem; border-radius: .375rem; border: 1px solid #d1d5db; background: #111827; color: white; cursor: pointer; }
          button:active { transform: translateY(1px); }
        `}</style>
        {/* Local fixi & extensions (vendored) */}
        <script src="/static/fixi/fixi.js"></script>
        <script src="/static/fixi/extensions.js"></script>
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}

export function Counter(props: { count: number }) {
  const { count } = props;
  return (
    <div id="counter" className="counter">
      <form
        // Fixi-enhanced form: AJAX submit when JS is on
        fx-action="/counter"
        fx-method="post"
        fx-target="#counter"
        fx-swap="outerHTML"
        // No-JS fallback: normal form POST refreshes whole page
        action="/counter"
        method="post"
      >
        <span>{e`Count: ${count}`}</span>
        <button type="submit">Increment</button>
      </form>
    </div>
  );
}

export function EventLog({ events }: { events: Array<{ id: number; text: string }> }) {
  return (
    <section style={{ marginTop: '1rem' }}>
      {/* Declarative autostart for SSE; non-JS users will just see SSR-rendered log below */}
      <div ext-fx-sse-autostart="/events" data-target="#event-log" data-swap="beforeend" />
      <h2 style={{ margin: '0 0 .5rem 0' }}>Log</h2>
      <div id="event-log">
        {events.map((e) => (
          <div>{e.text}</div>
        ))}
      </div>
    </section>
  );
}
