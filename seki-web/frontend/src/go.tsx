import { render } from "preact";
import { Goban } from "./goban/index";
import type {
  GameState,
  IncomingMessage,
  InitialGameProps,
  MarkerData,
  PlayerData,
  Point,
  TurnData,
} from "./goban/types";
import { createBoard, findNavButtons } from "./wasm-board";
import type { Board } from "./wasm-board";
import { appendToChat, renderChatHistory, setupChat } from "./chat";

const koMarker: MarkerData = { type: "triangle", label: "ko" };
const SYSTEM_SENDER = "⚑";

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

export function go(root: HTMLElement) {
  const props: InitialGameProps = JSON.parse(root.dataset.props!);
  const gameId = root.dataset.gameId!;
  const playerData = readPlayerData();
  const playerStone = derivePlayerStone(playerData, props.black, props.white);
  const analysisStorageKey = `seki:game:${gameId}:analysis`;

  console.debug("InitialGameProps", props);
  console.debug("PlayerData", playerData, "playerStone", playerStone);

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
      ws.send(
        JSON.stringify({ action: "respond_to_undo", response: "accept" }),
      );
    },
    rejectUndo(): void {
      ws.send(
        JSON.stringify({ action: "respond_to_undo", response: "reject" }),
      );
    },
  };

  let gameState = props.state;
  let currentTurn: number | null = null;
  let moves: TurnData[] = [];
  let undoRejected = false;
  let result: string | null = null;

  // Analysis mode: when true, vertex clicks go to local engine; when false, live play via WS
  let analysisMode = false;

  // Board instance — created asynchronously
  let board: Board | undefined;

  // DOM elements
  const statusEl = document.getElementById("status");
  const titleEl = document.getElementById("game-title");
  const gobanEl = document.getElementById("goban")!;
  const passBtn = document.getElementById("pass-btn") as HTMLButtonElement | null;
  const resignBtn = document.getElementById("resign-btn") as HTMLButtonElement | null;
  const requestUndoBtn = document.getElementById("request-undo-btn") as HTMLButtonElement | null;
  const resetBtn = document.getElementById("reset-btn") as HTMLButtonElement | null;
  const analyzeBtn = document.getElementById("analyze-btn") as HTMLButtonElement | null;
  const exitAnalysisBtn = document.getElementById("exit-analysis-btn") as HTMLButtonElement | null;

  function isLiveClickable(): boolean {
    if (analysisMode) {
      return false;
    }
    if (!board || !board.engine.is_at_latest()) {
      return false;
    }
    if (playerStone === 0) {
      return false;
    }
    return (
      gameState.stage === "unstarted" ||
      gameState.stage === "play" ||
      gameState.stage === "territory_review"
    );
  }

  function handleVertexClick(col: number, row: number): boolean {
    if (!isLiveClickable()) {
      return false;
    }
    if (gameState.stage === "territory_review") {
      channel.toggleChain(col, row);
    } else {
      channel.play(col, row);
    }
    return true;
  }

  function enterAnalysis() {
    analysisMode = true;
    updateActions();
    if (board) {
      board.render();
    }
  }

  function exitAnalysis() {
    analysisMode = false;
    if (board) {
      board.engine.to_latest();
      renderGoban(gameState);
    }
    updateActions();
  }

  // Render from server state (live board at latest position, not in analysis)
  function renderGoban(state: GameState): void {
    if (state.board.length === 0) {
      return;
    }

    const { board: boardData, cols, rows, ko } = state;

    const onVertexClick = isLiveClickable()
      ? (_: Event, position: Point) => {
          if (state.stage === "territory_review") {
            channel.toggleChain(position[0], position[1]);
          } else {
            channel.play(position[0], position[1]);
          }
        }
      : undefined;

    const markerMap: (MarkerData | null)[] = Array(boardData.length).fill(null);

    if (ko != null) {
      markerMap[ko.pos[1] * cols + ko.pos[0]] = koMarker;
    }

    const avail = gobanEl.clientWidth;
    const extra = 0.8;
    const vertexSize = Math.max(avail / (Math.max(cols, rows) + extra), 12);

    render(
      <Goban
        cols={cols}
        rows={rows}
        vertexSize={vertexSize}
        signMap={boardData}
        markerMap={markerMap}
        fuzzyStonePlacement
        animateStonePlacement
        onVertexClick={onVertexClick}
      />,
      gobanEl,
    );
  }

  // Initialize the board
  createBoard({
    cols: gameState.cols,
    rows: gameState.rows,
    gobanEl,
    storageKey: analysisStorageKey,
    baseMoves: moves.length > 0 ? JSON.stringify(moves) : undefined,
    navButtons: findNavButtons(),
    buttons: {
      reset: resetBtn,
    },
    onVertexClick: (col, row) => handleVertexClick(col, row),
    onRender: () => {
      // When the board renders from the engine, update undo controls visibility
      updateActions();
    },
    onEscape: () => {
      if (analysisMode) {
        exitAnalysis();
      }
    },
  }).then((b) => {
    board = b;
    // Sync any moves that arrived via WS while WASM was loading
    if (moves.length > 0) {
      board.updateBaseMoves(JSON.stringify(moves));
    }
    renderGoban(gameState);
    board.updateNav();
  });

  function updateTitle(description: string): void {
    if (titleEl) {
      titleEl.textContent = description;
    }
  }

  function updateStatus(): void {
    if (!statusEl) {
      return;
    }
    if (gameState.stage === "play") {
      statusEl.textContent =
        currentTurn === 1 ? "Black to play" : "White to play";
    } else if (gameState.stage === "done" && result) {
      statusEl.textContent = result;
    } else {
      statusEl.textContent = "";
    }
  }

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
          currentTurn = data.current_turn_stone;
          moves = data.moves ?? [];
          undoRejected = data.undo_rejected;
          result = data.result;

          console.debug("WebSocket: state updated", {
            currentState: gameState,
            currentTurn,
          });

          if (board) {
            board.updateBaseMoves(JSON.stringify(moves), !analysisMode);
            if (!analysisMode && board.engine.is_at_latest()) {
              renderGoban(gameState);
            }
            board.updateNav();
          }
          updateActions();
          updateTitle(data.description);
          updateStatus();
          break;
        case "chat":
          appendToChat({
            sender: data.sender,
            text: data.text,
            move_number: data.move_number,
            sent_at: data.sent_at,
          });
          break;
        case "error":
          showError(data.message);
          break;
        case "undo_accepted":
        case "undo_rejected":
          appendToChat({
            sender: SYSTEM_SENDER,
            text: data.message,
            move_number: data.move_number,
            sent_at: data.sent_at,
          });
          showUndoResult(data.message);
          if (data.undo_rejected !== undefined) {
            undoRejected = data.undo_rejected;
          }
          if (data.state) {
            gameState = data.state;
            currentTurn = data.current_turn_stone ?? null;
            if (data.moves) {
              moves = data.moves;
              if (board) {
                board.updateBaseMoves(JSON.stringify(moves), !analysisMode);
                if (!analysisMode && board.engine.is_at_latest()) {
                  renderGoban(data.state);
                }
                board.updateNav();
              }
            }
            updateActions();
            updateStatus();
          }
          break;
        case "undo_request_sent":
          appendToChat({
            sender: SYSTEM_SENDER,
            text: data.message,
            move_number: data.move_number,
            sent_at: data.sent_at,
          });
          showUndoWaitingState(data.message);
          break;
        case "undo_response_needed":
          appendToChat({
            sender: SYSTEM_SENDER,
            text: data.message,
            move_number: data.move_number,
            sent_at: data.sent_at,
          });
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

  // Game action handlers
  passBtn?.addEventListener("click", () => {
    if (analysisMode) {
      if (board && board.engine.pass()) {
        localStorage.setItem(analysisStorageKey, board.engine.moves_json());
        board.render();
      }
    } else {
      channel.pass();
    }
  });
  const confirmResignBtn = document.getElementById("confirm-resign-btn") as HTMLButtonElement | null;
  confirmResignBtn?.addEventListener("click", () => channel.resign());

  // Analysis mode handlers
  analyzeBtn?.addEventListener("click", () => enterAnalysis());
  exitAnalysisBtn?.addEventListener("click", () => exitAnalysis());

  // Resize: when at latest and not in analysis, re-render from server state
  window.addEventListener("resize", () => {
    if (!analysisMode && board && board.engine.is_at_latest()) {
      renderGoban(gameState);
    }
    // Board's own resize handler covers the WASM engine render case
  });

  // Render initial board from server state
  renderGoban(gameState);
  updateStatus();

  renderChatHistory();
  setupChat((text) => channel.say(text));

  // Undo button listeners
  requestUndoBtn?.addEventListener("click", () => {
    channel.requestUndo();
    requestUndoBtn.disabled = true;
  });

  document
    .getElementById("accept-undo-btn")
    ?.addEventListener("click", () => channel.acceptUndo());

  document
    .getElementById("reject-undo-btn")
    ?.addEventListener("click", () => channel.rejectUndo());

  function updateActions(): void {
    if (analysisMode) {
      if (passBtn) { passBtn.style.display = ""; }
      if (resignBtn) { resignBtn.style.display = "none"; }
      if (requestUndoBtn) { requestUndoBtn.style.display = "none"; }
      if (resetBtn) { resetBtn.style.display = ""; }
      if (analyzeBtn) { analyzeBtn.style.display = "none"; }
      if (exitAnalysisBtn) { exitAnalysisBtn.style.display = ""; }
      return;
    }

    // Live mode
    const isPlay = gameState.stage === "play";

    if (passBtn) {
      passBtn.style.display = playerStone !== 0 && isPlay ? "" : "none";
    }
    if (resignBtn) {
      resignBtn.style.display = isPlay ? "" : "none";
    }
    if (resetBtn) { resetBtn.style.display = "none"; }
    if (analyzeBtn) { analyzeBtn.style.display = ""; }
    if (exitAnalysisBtn) { exitAnalysisBtn.style.display = "none"; }

    if (requestUndoBtn) {
      requestUndoBtn.style.display = isPlay ? "" : "none";
      const canUndo =
        moves.length > 0 &&
        playerStone !== 0 &&
        currentTurn !== playerStone &&
        !undoRejected;

      requestUndoBtn.disabled = !canUndo;
      if (undoRejected) {
        requestUndoBtn.title = "Undo was rejected for this move";
      } else if (moves.length === 0) {
        requestUndoBtn.title = "No moves to undo";
      } else if (currentTurn === playerStone) {
        requestUndoBtn.title = "Cannot undo on your turn";
      } else {
        requestUndoBtn.title = "Request to undo your last move";
      }
    }
  }

  updateActions();
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
