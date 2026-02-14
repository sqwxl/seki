import { render } from "preact";
import { Goban } from "./goban/index";
import type {
  GameStage,
  GameState,
  IncomingMessage,
  InitialGameProps,
  MarkerData,
  PlayerData,
  Point,
} from "./goban/types";

let ws: WebSocket;

const channel = {
  play(col: number, row: number): void {
    ws.send(JSON.stringify({ action: "play", col, row }));
  },
  pass(): void {
    ws.send(JSON.stringify({ action: "pass" }));
  },
  resign(): void {
    ws.send(JSON.stringify({ action: "resign" }));
  },
  toggleChain(col: number, row: number): void {
    ws.send(JSON.stringify({ action: "toggle_chain", col, row }));
  },
  say(message: string): void {
    ws.send(JSON.stringify({ action: "chat", message }));
  },
  requestUndo(): void {
    ws.send(JSON.stringify({ action: "request_undo" }));
  },
  acceptUndo(): void {
    ws.send(JSON.stringify({ action: "respond_to_undo", response: "accept" }));
  },
  rejectUndo(): void {
    ws.send(JSON.stringify({ action: "respond_to_undo", response: "reject" }));
  },
  respondToUndo(response: string): void {
    ws.send(JSON.stringify({ action: "respond_to_undo", response }));
  },
};

function readPlayerData(): PlayerData | undefined {
  const el = document.getElementById("player-data");
  if (!el || !el.textContent) {
    return;
  }
  return JSON.parse(el.textContent);
}

function derivePlayerStone(
  playerData: PlayerData | undefined,
  black: PlayerData | null,
  white: PlayerData | null,
): number {
  if (!playerData) {
    return 0;
  }
  if (black && black.id === playerData.id) {
    return 1;
  }
  if (white && white.id === playerData.id) {
    return -1;
  }
  return 0;
}

const koMarker: MarkerData = { type: "triangle", label: "ko" };

export function go(root: HTMLElement) {
  const props: InitialGameProps = JSON.parse(root.dataset.props!);
  const playerData = readPlayerData();
  const playerStone = derivePlayerStone(playerData, props.black, props.white);

  console.debug("InitialGameProps", props);
  console.debug("PlayerData", playerData, "playerStone", playerStone);

  let gameState = props.state;
  let currentNegotiations: Record<string, unknown> = {};
  let currentTurn: number | null = null;

  function connectWS(): void {
    const wsURL = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}${window.location.pathname}/ws`;

    ws = new WebSocket(wsURL);

    ws.onopen = () => console.debug("WebSocket: connected");

    ws.onmessage = (event: MessageEvent) => {
      console.debug("WebSocket: incoming", event);

      const data: IncomingMessage = JSON.parse(event.data);

      switch (data.kind) {
        case "state":
          gameState = data.state;
          currentNegotiations = data.negotiations ?? {};
          currentTurn = data.current_turn_stone;

          console.debug("WebSocket: state updated", {
            currentState: gameState,
            currentTurn,
          });

          renderGoban(gameState);
          updateUndoControls(gameState.stage, currentNegotiations, currentTurn);
          break;
        case "chat":
          appendToChat(data.sender, data.text);
          break;
        case "error":
          showError(data.message);
          break;
        case "undo_accepted":
        case "undo_rejected":
          showUndoResult(data.message);
          if (data.state) {
            renderGoban(data.state);
            currentTurn = data.current_turn_stone ?? null;
            updateUndoControls(data.state.stage, {}, currentTurn);
          }
          break;
        case "undo_request_sent":
          showUndoWaitingState(data.message);
          break;
        case "undo_response_needed":
          showUndoResponseControls(data.requesting_player, data.message);
          break;
        default:
          console.warn("WebSocket: unknown message kind", data);
          break;
      }
    };

    ws.onclose = () => {
      console.info("WebSocket: connection closed, reconnecting in 2s...");
      setTimeout(connectWS, 2000);
    };

    ws.onerror = (err) => {
      console.error("WebSocket: error", err);
    };
  }

  connectWS();

  function vertexCallback():
    | ((evt: Event, position: Point) => void)
    | undefined {
    if (playerStone === 0) {
      return;
    }
    if (gameState.stage === "unstarted" || gameState.stage === "play") {
      return (_: Event, position: Point) =>
        channel.play(position[0], position[1]);
    }
    if (gameState.stage === "territory_review") {
      return (_: Event, position: Point) =>
        channel.toggleChain(position[0], position[1]);
    }

    return;
  }

  const gobanEl = document.getElementById("goban")!;

  function vertexSize(cols: number, rows: number): number {
    const avail = gobanEl.clientWidth;
    // Board border (0.15em each side) + padding (0.25em each side) = 0.8em extra
    const extra = 0.8;
    return Math.max(avail / (Math.max(cols, rows) + extra), 12);
  }

  function renderGoban(state: GameState): void {
    if (state.board.length === 0) {
      return;
    }

    const { board, cols, rows, ko } = state;

    const onVertexClick = vertexCallback();

    const markerMap = Array(board.length).fill(null);

    if (ko != null) {
      markerMap[ko.pos[1] * cols + ko.pos[0]] = koMarker;
    }

    render(
      <Goban
        cols={cols}
        rows={rows}
        vertexSize={vertexSize(cols, rows)}
        signMap={board}
        markerMap={markerMap}
        fuzzyStonePlacement
        animateStonePlacement
        onVertexClick={onVertexClick}
      />,
      gobanEl,
    );
  }

  window.addEventListener("resize", () => renderGoban(gameState));

  // Render initial board
  renderGoban(gameState);

  renderChatHistory();

  function updateUndoControls(
    stage: GameStage,
    _negotiations: Record<string, unknown> = {},
    turnStone: number | null = null,
  ): void {
    const requestBtn = document.getElementById(
      "request-undo-btn",
    ) as HTMLButtonElement | null;
    const responseControls = document.getElementById("undo-response-controls");
    const notification = document.getElementById("undo-notification");

    if (!requestBtn) {
      return;
    }

    // Reset UI state
    requestBtn.disabled = false;
    responseControls!.style.display = "none";
    notification!.style.display = "none";

    // Only show controls during play stage and if player is actually playing
    if (stage !== "play" || playerStone === 0) {
      requestBtn.style.display = "none";
      return;
    }

    requestBtn.style.display = "inline-block";

    if (turnStone === playerStone) {
      requestBtn.disabled = true;
      requestBtn.title = "Cannot undo on your turn";
    } else {
      requestBtn.disabled = false;
      requestBtn.title = "Request to undo your last move";
    }
  }
}

function appendToChat(sender: string, text: string): void {
  const box = document.getElementById("chat-box")!;
  const p = document.createElement("p");
  p.textContent = `${sender}: ${text}`;
  box.appendChild(p);
  box.scrollTop = box.scrollHeight;
}

function renderChatHistory(): void {
  const box = document.getElementById("chat-box")!;
  const rawMessages = box.dataset.chatLog;

  if (!rawMessages) {
    return;
  }

  const messages: { sender: string; text: string }[] = JSON.parse(rawMessages);
  for (const msg of messages) {
    appendToChat(msg.sender, msg.text);
  }
}

function showError(message: string): void {
  if (!message) {
    return;
  }
  document.getElementById("game-error")!.innerText = message;
}

function showUndoResult(message: string): void {
  const notification = document.getElementById("undo-notification")!;
  const responseControls = document.getElementById("undo-response-controls")!;

  responseControls.style.display = "none";
  notification.style.display = "block";
  notification.textContent = message;

  setTimeout(() => {
    notification.style.display = "none";
  }, 5000);
}

function showUndoWaitingState(message: string): void {
  const requestBtn = document.getElementById(
    "request-undo-btn",
  ) as HTMLButtonElement;
  const notification = document.getElementById("undo-notification")!;
  const responseControls = document.getElementById("undo-response-controls")!;

  responseControls.style.display = "none";
  requestBtn.disabled = true;
  notification.style.display = "block";
  notification.textContent = message;
}

function showUndoResponseControls(
  _requestingPlayer: string,
  message: string,
): void {
  const requestBtn = document.getElementById(
    "request-undo-btn",
  ) as HTMLButtonElement;
  const notification = document.getElementById("undo-notification")!;
  const responseControls = document.getElementById("undo-response-controls")!;

  requestBtn.disabled = true;
  responseControls.style.display = "block";
  notification.style.display = "block";
  notification.textContent = message;
}

document.getElementById("chat-form")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("chat-input") as HTMLInputElement;
  const text = input.value.trim();
  if (text) {
    channel.say(text);
    input.value = "";
  }
});

document.getElementById("request-undo-btn")?.addEventListener("click", () => {
  channel.requestUndo();
  (document.getElementById("request-undo-btn") as HTMLButtonElement).disabled =
    true;
  document.getElementById("undo-notification")!.style.display = "block";
  document.getElementById("undo-notification")!.textContent =
    "Undo request sent. Waiting for opponent response...";
});

document
  .getElementById("accept-undo-btn")
  ?.addEventListener("click", () => channel.acceptUndo());

document
  .getElementById("reject-undo-btn")
  ?.addEventListener("click", () => channel.rejectUndo());
