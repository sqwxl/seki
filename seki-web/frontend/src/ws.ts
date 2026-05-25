import { signal } from "@preact/signals";

/**
 * Shared live WebSocket connection.
 *
 * Manages a single WebSocket to /live with auto-reconnect.
 * Components subscribe to specific event kinds via `subscribe()`.
 * Game pages use `joinGame()` to subscribe to a game room.
 */

type Handler = (data: Record<string, unknown>) => void;
type TypedHandler<T> = (data: T) => void;

// Global "kind" handlers (lobby events like init, game_updated, game_removed)
const handlers = new Map<string, Set<Handler>>();

// Per-game handlers keyed by game_id
const gameHandlers = new Map<number, Handler>();

declare global {
  interface Window {
    __ws?: { close: () => void };
  }
}

let ws: WebSocket | undefined;

window.__ws = { close: () => ws?.close() };

let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let pingTimeout: ReturnType<typeof setTimeout> | undefined;
let pendingSends: string[] = [];

/** Reflects whether the WebSocket is currently open. */
export const wsConnected = signal(false);

const HEALTH_CHECK_TIMEOUT_MS = 3000;

/** Cancel any pending reconnect timer and connect immediately. */
function reconnectNow() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }
  if (pingTimeout) {
    clearTimeout(pingTimeout);
    pingTimeout = undefined;
  }
  if (ws) {
    ws.close();
    ws = undefined;
  }
  connect();
}

/**
 * Called when the page becomes visible (tab switch, app resume, bfcache restore).
 * Checks connection health and reconnects if needed.
 */
function becameVisible() {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    // Not connected or socket is closing/closed — reconnect immediately.
    // Don't wait for a throttled setTimeout that may never fire.
    reconnectNow();
    return;
  }

  // Socket looks open but may be half-open (OS suspended, server cleaned up).
  // Send a ping and wait for a response.
  ws.send(JSON.stringify({ action: "ping" }));
  pingTimeout = setTimeout(() => {
    pingTimeout = undefined;
    // No response — socket is dead
    reconnectNow();
  }, HEALTH_CHECK_TIMEOUT_MS);
}

function ensureConnected() {
  if (!ws && !reconnectTimer) {
    connect();
  }
}

const RECONNECT_TIMEOUT_MS = 2000;

function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${proto}//${location.host}/ws`;

  ws = new WebSocket(url);

  ws.onopen = () => {
    wsConnected.value = true;

    // Cancel any health check timeout — we're alive
    if (pingTimeout) {
      clearTimeout(pingTimeout);
      pingTimeout = undefined;
    }

    // Notify game handlers before re-joining so they can reset stale state
    for (const [gameId, handler] of gameHandlers) {
      handler({ kind: "ws_reconnected", game_id: gameId });
    }

    // Re-join any game rooms after reconnect
    for (const gameId of gameHandlers.keys()) {
      ws!.send(JSON.stringify(joinGameMessage(gameId)));
    }

    // Flush pending sends
    for (const msg of pendingSends) {
      ws!.send(msg);
    }

    pendingSends = [];
  };

  ws.onmessage = (event: MessageEvent) => {
    let data: Record<string, unknown>;

    try {
      data = JSON.parse(event.data);
    } catch (e) {
      console.error("WS: malformed message", e);
      return;
    }

    const kind = data.kind as string;

    // Any server message confirms the connection is healthy
    if (pingTimeout) {
      clearTimeout(pingTimeout);
      pingTimeout = undefined;
    }

    const kindHandlers = handlers.get(kind);

    if (kindHandlers) {
      for (const handler of kindHandlers) {
        handler(data);
      }
    }

    const gameId = data.game_id as number | undefined;

    // Route game-specific messages to the game handler. Some lobby messages
    // such as game_removed also carry a game_id, so kind handlers run first.
    if (gameId != null) {
      const handler = gameHandlers.get(gameId);

      if (handler) {
        handler(data);
      }
    }
  };

  ws.onclose = () => {
    wsConnected.value = false;

    if (pingTimeout) {
      clearTimeout(pingTimeout);
      pingTimeout = undefined;
    }

    // Notify game handlers that we're disconnected so they can show UI feedback
    for (const [gameId, handler] of gameHandlers) {
      handler({ kind: "ws_disconnected", game_id: gameId });
    }

    ws = undefined;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, RECONNECT_TIMEOUT_MS);
  };

  ws.onerror = () => {
    // onclose will fire after onerror, triggering reconnect
  };
}

function joinGameMessage(gameId: number): Record<string, unknown> {
  const search = new URLSearchParams(location.search);

  return {
    action: "join_game",
    game_id: gameId,
    access_token: search.get("access_token") ?? undefined,
    invite_token: search.get("invite_token") ?? undefined,
  };
}

/**
 * Send a JSON message to the server.
 * If the socket isn't ready yet, the message is queued.
 */
function send(data: Record<string, unknown>): void {
  const msg = JSON.stringify(data);

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(msg);
  } else {
    pendingSends.push(msg);

    ensureConnected();
  }
}

/**
 * Subscribe to a specific event kind (lobby-level). Returns an unsubscribe function.
 * Lazily connects the WebSocket on first subscription.
 *
 * The generic parameter lets callers specify the expected message shape,
 * avoiding `as unknown as` casts at the call site. The boundary is still
 * untyped at runtime (messages arrive as JSON), so the type parameter is
 * trusted by convention.
 */
function subscribe<T extends Record<string, unknown> = Record<string, unknown>>(
  kind: string,
  handler: TypedHandler<T>,
): () => void {
  let kindHandlers = handlers.get(kind);

  if (!kindHandlers) {
    kindHandlers = new Set();
    handlers.set(kind, kindHandlers);
  }

  kindHandlers.add(handler as Handler);

  ensureConnected();

  return () => {
    kindHandlers!.delete(handler as Handler);

    if (kindHandlers!.size === 0) {
      handlers.delete(kind);
    }
  };
}

/**
 * Join a game room. All messages for this game will be routed to `handler`.
 * Returns an unsubscribe function that sends `leave_game` and removes the handler.
 */
function joinGame(gameId: number, handler: Handler): () => void {
  gameHandlers.set(gameId, handler);
  // Only send immediately if the socket is already open.
  // Otherwise, onopen will re-join all games from gameHandlers.
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(joinGameMessage(gameId)));
  } else {
    ensureConnected();
  }

  return () => {
    gameHandlers.delete(gameId);
    send({ action: "leave_game", game_id: gameId });
  };
}

function isGameActive(gameId: number): boolean {
  return gameHandlers.has(gameId);
}

/**
 * Subscribe to presence updates for specific user IDs.
 * Server responds with "presence_state" and pushes "presence_changed" thereafter.
 */
function subscribePresence(userIds: number[]): void {
  send({ action: "subscribe_presence", user_ids: userIds });
}

// Send "bye" before the page unloads so the server knows it's a deliberate leave
window.addEventListener("beforeunload", () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action: "bye" }));
  }
});

// Reconnect when the page becomes visible (tab switch, app resume on mobile).
// Guarded: jsdom test environment may not have addEventListener on document.
if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      becameVisible();
    }
  });
}

// Handle bfcache restore (mobile browsers may freeze the page)
if (typeof window !== "undefined") {
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      becameVisible();
    }
  });
}

export {
  ensureConnected,
  isGameActive,
  joinGame,
  send,
  subscribe,
  subscribePresence,
};
