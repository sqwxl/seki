import { render } from "preact";
import { BoundedGoban as Goban } from "./goban/index";
import type {
  GameStage,
  GameState,
  IncomingMessage,
  MarkerData,
  Position,
} from "./goban/types";

const koMarker: MarkerData = { type: "triangle", label: "ko" };

const root = document.getElementById("game");

if (root != null) {
  const gameId = root.dataset.gameId!;
  const playerId = root.dataset.playerId!;
  const playerName = root.dataset.playerName!;
  const playerStone = parseInt(root.dataset.playerStone!, 10);
  const boardCols = parseInt(root.dataset.boardCols!, 10);
  const boardRows = parseInt(root.dataset.boardRows!, 10);

  console.log("Game initialized:", {
    gameId,
    playerId,
    playerName,
    playerStone,
    boardCols,
    boardRows,
  });

  const emptyBoard = Array.from({ length: boardRows }, () =>
    Array(boardCols).fill(0),
  );

  let currentStage: GameStage | null = null;
  let currentGameState: GameState = { board: emptyBoard, ko: null };
  let currentNegotiations: Record<string, unknown> = {};
  let currentTurnStone: number | null = null;

  // --- WebSocket connection ---
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${wsProtocol}//${window.location.host}/games/${gameId}/ws`;
  let ws: WebSocket | null = null;

  function connectWebSocket(): void {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log("WebSocket connected");
    };

    ws.onmessage = (event: MessageEvent) => {
      const data: IncomingMessage = JSON.parse(event.data);
      console.log("WebSocket received:", data);

      switch (data.kind) {
        case "state":
          currentStage = data.stage;
          currentGameState = data.state;
          currentNegotiations = data.negotiations ?? {};
          currentTurnStone = data.current_turn_stone;

          console.log("State updated:", {
            currentStage,
            currentTurnStone,
            playerStone,
            playerName,
          });

          renderGoban(currentStage, currentGameState);
          updateUndoControls(
            currentStage,
            currentNegotiations,
            currentTurnStone,
          );
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
          if (data.stage && data.state) {
            renderGoban(data.stage, data.state);
            currentTurnStone = data.current_turn_stone ?? null;
            updateUndoControls(data.stage, {}, currentTurnStone);
          }
          break;
        case "undo_request_sent":
          showUndoWaitingState(data.message);
          break;
        case "undo_response_needed":
          showUndoResponseControls(data.requesting_player, data.message);
          break;
      }
    };

    ws.onclose = () => {
      console.log("WebSocket closed, reconnecting in 2s...");
      setTimeout(connectWebSocket, 2000);
    };

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
    };
  }

  connectWebSocket();

  // --- Channel-like API using raw WebSocket ---
  const channel = {
    play(col: number, row: number): void {
      ws?.send(JSON.stringify({ action: "play", col, row }));
    },
    pass(): void {
      ws?.send(JSON.stringify({ action: "pass" }));
    },
    resign(): void {
      ws?.send(JSON.stringify({ action: "resign" }));
    },
    toggleChain(col: number, row: number): void {
      ws?.send(JSON.stringify({ action: "toggle_chain", col, row }));
    },
    chat(text: string): void {
      ws?.send(JSON.stringify({ action: "chat", message: text }));
    },
    requestUndo(): void {
      ws?.send(JSON.stringify({ action: "request_undo" }));
    },
    respondToUndo(response: string): void {
      ws?.send(JSON.stringify({ action: "respond_to_undo", response }));
    },
  };

  function vertexCallback():
    | ((evt: Event, position: Position) => void)
    | undefined {
    if (currentStage === "unstarted" || currentStage === "play") {
      return (_: Event, position: Position) =>
        channel.play(position[0], position[1]);
    }
    if (currentStage === "territory_review") {
      return (_: Event, position: Position) =>
        channel.toggleChain(position[0], position[1]);
    }
    return undefined;
  }

  function renderGoban(
    _stage: GameStage | null,
    gameState: GameState,
  ): void {
    if (!gameState?.board) return;

    const { board, ko } = gameState;
    const onVertexClick = vertexCallback();
    const signMap = board;

    const markerMap = Array.from({ length: board.length }, () =>
      Array<MarkerData | null>(board[0].length).fill(null),
    );

    if (ko != null) {
      markerMap[ko.pos[0]][ko.pos[1]] = koMarker;
    }

    render(
      <Goban
        maxWidth={800}
        maxHeight={800}
        signMap={signMap}
        markerMap={markerMap}
        fuzzyStonePlacement
        animateStonePlacement
        onVertexClick={onVertexClick}
      />,
      document.getElementById("goban")!,
    );
  }

  // Render empty board immediately so user sees the game board
  renderGoban(null, currentGameState);

  renderChatLog();

  document.getElementById("chat-form")!.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("chat-input") as HTMLInputElement;
    const text = input.value.trim();
    if (text) {
      channel.chat(text);
      input.value = "";
    }
  });

  function renderChatLog(): void {
    const box = document.getElementById("chat-box")!;
    const raw = box.dataset.chatLog;
    if (raw == null) return;

    const messages: { sender: string; text: string }[] = JSON.parse(raw);
    for (const msg of messages) {
      appendToChat(msg.sender, msg.text);
    }
  }

  function appendToChat(sender: string, text: string): void {
    const box = document.getElementById("chat-box")!;
    const p = document.createElement("p");
    p.textContent = `${sender}: ${text}`;
    box.appendChild(p);
    box.scrollTop = box.scrollHeight;
  }

  function showError(message: string): void {
    if (!message) return;
    document.getElementById("game-error")!.innerText = message;
  }

  function updateUndoControls(
    stage: GameStage,
    _negotiations: Record<string, unknown> = {},
    turnStone: number | null = null,
  ): void {
    console.log("updateUndoControls called:", {
      stage,
      negotiations: _negotiations,
      turnStone,
      playerStone,
      playerName,
    });

    const requestBtn = document.getElementById(
      "request-undo-btn",
    ) as HTMLButtonElement | null;
    const responseControls = document.getElementById(
      "undo-response-controls",
    );
    const notification = document.getElementById("undo-notification");

    if (!requestBtn) {
      console.error("request-undo-btn not found!");
      return;
    }

    // Reset UI state
    requestBtn.disabled = false;
    responseControls!.style.display = "none";
    notification!.style.display = "none";

    // Only show controls during play stage and if player is actually playing
    if (stage !== "play" || playerStone === 0) {
      console.log(
        "Hiding button: stage =",
        stage,
        "playerStone =",
        playerStone,
      );
      requestBtn.style.display = "none";
      return;
    }

    console.log("Showing button");
    requestBtn.style.display = "inline-block";

    if (turnStone === playerStone) {
      console.log("Disabling button: player's turn");
      requestBtn.disabled = true;
      requestBtn.title = "Cannot undo on your turn";
    } else {
      console.log("Enabling button: can request undo");
      requestBtn.disabled = false;
      requestBtn.title = "Request to undo your last move";
    }
  }

  function showUndoResult(message: string): void {
    const notification = document.getElementById("undo-notification")!;
    const responseControls = document.getElementById(
      "undo-response-controls",
    )!;

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
    const responseControls = document.getElementById(
      "undo-response-controls",
    )!;

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
    const responseControls = document.getElementById(
      "undo-response-controls",
    )!;

    requestBtn.disabled = true;
    responseControls.style.display = "block";
    notification.style.display = "block";
    notification.textContent = message;
  }

  // Event listeners for undo controls
  document
    .getElementById("request-undo-btn")!
    .addEventListener("click", () => {
      channel.requestUndo();
      (
        document.getElementById("request-undo-btn") as HTMLButtonElement
      ).disabled = true;
      document.getElementById("undo-notification")!.style.display = "block";
      document.getElementById("undo-notification")!.textContent =
        "Undo request sent. Waiting for opponent response...";
    });

  document
    .getElementById("accept-undo-btn")!
    .addEventListener("click", () => {
      channel.respondToUndo("accept");
    });

  document
    .getElementById("reject-undo-btn")!
    .addEventListener("click", () => {
      channel.respondToUndo("reject");
    });
}
