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

let ws: WebSocket | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let pendingSends: string[] = [];

function ensureConnected() {
  if (!ws && !reconnectTimer) {
    connect();
  }
}

function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${proto}//${location.host}/ws`;
  ws = new WebSocket(url);

  ws.onopen = () => {
    // Re-join any game rooms after reconnect
    for (const gameId of gameHandlers.keys()) {
      ws!.send(JSON.stringify({ action: "join_game", game_id: gameId }));
    }
    // Flush pending sends
    for (const msg of pendingSends) {
      ws!.send(msg);
    }
    pendingSends = [];
  };

  ws.onmessage = (event: MessageEvent) => {
    const data = JSON.parse(event.data);
    const gameId = data.game_id as number | undefined;

    // Route game-specific messages to the game handler
    if (gameId != null) {
      const handler = gameHandlers.get(gameId);
      if (handler) {
        handler(data);
      }
      return;
    }

    // Route by kind (lobby events)
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
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, 2000);
  };

  ws.onerror = () => {
    // onclose will fire after onerror, triggering reconnect
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
    ws.send(JSON.stringify({ action: "join_game", game_id: gameId }));
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

export { ensureConnected, subscribe, send, joinGame, isGameActive };
