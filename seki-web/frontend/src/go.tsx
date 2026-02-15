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
  TurnData,
} from "./goban/types";
import { createBoard, findNavButtons } from "./wasm-board";
import type { Board } from "./wasm-board";
import { appendToChat, renderChatHistory, setupChat } from "./chat";

const koMarker: MarkerData = { type: "triangle", label: "ko" };

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

  // Analysis mode: when true, vertex clicks go to local engine; when false, live play via WS
  let analysisMode = false;

  // Board instance — created asynchronously
  let board: Board | undefined;

  // DOM elements
  const titleEl = document.getElementById("game-title");
  const gobanEl = document.getElementById("goban")!;
  const analyzeBtn = document.getElementById(
    "analyze-btn",
  ) as HTMLButtonElement | null;
  const analysisControls = document.getElementById("analysis-controls");
  const gameActions = document.getElementById("game-actions");
  const exitAnalysisBtn = document.getElementById(
    "exit-analysis-btn",
  ) as HTMLButtonElement | null;
  const gamePassBtn = document.getElementById(
    "game-pass-btn",
  ) as HTMLButtonElement | null;
  const resignBtn = document.getElementById(
    "resign-btn",
  ) as HTMLButtonElement | null;

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
    if (analysisControls) {
      analysisControls.style.display = "flex";
    }
    if (gameActions) {
      gameActions.style.display = "none";
    }
    if (analyzeBtn) {
      analyzeBtn.style.display = "none";
    }
    if (board) {
      board.render();
    }
    updateGameActions(gameState.stage, currentTurn);
  }

  function exitAnalysis() {
    analysisMode = false;
    if (analysisControls) {
      analysisControls.style.display = "none";
    }
    if (gameActions) {
      gameActions.style.display = "";
    }
    if (analyzeBtn) {
      analyzeBtn.style.display = "";
    }

    if (board) {
      // When exiting analysis, if at latest, render from server state instead of engine
      if (board.engine.is_at_latest()) {
        renderGoban(gameState);
      } else {
        board.render();
      }
    }
    updateGameActions(gameState.stage, currentTurn);
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
      undo: document.getElementById("undo-btn") as HTMLButtonElement | null,
      pass: document.getElementById("pass-btn") as HTMLButtonElement | null,
      reset: document.getElementById("reset-btn") as HTMLButtonElement | null,
    },
    onVertexClick: (col, row) => handleVertexClick(col, row),
    onRender: () => {
      // When the board renders from the engine, update undo controls visibility
      updateGameActions(gameState.stage, currentTurn);
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
          updateGameActions(gameState.stage, currentTurn);
          updateTitle(data.description);
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
            updateGameActions(data.state.stage, currentTurn);
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

  // Game action handlers
  gamePassBtn?.addEventListener("click", () => channel.pass());
  resignBtn?.addEventListener("click", () => channel.resign());

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

  renderChatHistory();
  setupChat((text) => channel.say(text));

  // Undo button listeners
  document.getElementById("request-undo-btn")?.addEventListener("click", () => {
    channel.requestUndo();
    (
      document.getElementById("request-undo-btn") as HTMLButtonElement
    ).disabled = true;
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

  function updateGameActions(stage: GameStage, turnStone: number | null): void {
    if (!gameActions) {
      return;
    }

    if (analysisMode || stage !== "play") {
      gameActions.style.display = "none";
      return;
    }

    gameActions.style.display = "flex";

    const requestBtn = document.getElementById(
      "request-undo-btn",
    ) as HTMLButtonElement | null;
    if (requestBtn) {
      if (turnStone === playerStone) {
        requestBtn.disabled = true;
        requestBtn.title = "Cannot undo on your turn";
      } else {
        requestBtn.disabled = false;
        requestBtn.title = "Request to undo your last move";
      }
    }
  }

  updateGameActions(gameState.stage, currentTurn);
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
