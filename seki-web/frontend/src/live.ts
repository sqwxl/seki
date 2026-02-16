/**
 * Shared live WebSocket connection.
 *
 * Manages a single WebSocket to /live with auto-reconnect.
 * Components subscribe to specific event kinds via `subscribe()`.
 */

type Handler = (data: Record<string, unknown>) => void;

const handlers = new Map<string, Set<Handler>>();
let ws: WebSocket | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${proto}//${location.host}/live`;
  ws = new WebSocket(url);

  ws.onmessage = (event: MessageEvent) => {
    const data = JSON.parse(event.data);
    const kind = data.kind as string;
    const kindHandlers = handlers.get(kind);
    if (kindHandlers) {
      for (const handler of kindHandlers) {
        handler(data);
      }
    }
  };

  ws.onclose = () => {
    ws = undefined;
    reconnectTimer = setTimeout(connect, 2000);
  };

  ws.onerror = () => {
    // onclose will fire after onerror, triggering reconnect
  };
}

/**
 * Subscribe to a specific event kind. Returns an unsubscribe function.
 * Lazily connects the WebSocket on first subscription.
 */
function subscribe(kind: string, handler: Handler): () => void {
  let kindHandlers = handlers.get(kind);
  if (!kindHandlers) {
    kindHandlers = new Set();
    handlers.set(kind, kindHandlers);
  }
  kindHandlers.add(handler);

  // Connect lazily
  if (!ws && !reconnectTimer) {
    connect();
  }

  return () => {
    kindHandlers!.delete(handler);
    if (kindHandlers!.size === 0) {
      handlers.delete(kind);
    }
  };
}

export { subscribe };
