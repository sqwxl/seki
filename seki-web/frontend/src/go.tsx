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
import type { WasmEngine } from "/static/wasm/go_engine_wasm.js";
import {
  ensureWasm,
  findNavButtons,
  updateNavButtons as updateNavButtonsShared,
  renderFromEngine,
  navigateEngine,
  setupKeyboardNav,
  computeVertexSize,
} from "./wasm-board";
import { appendToChat, renderChatHistory, setupChat } from "./chat";

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
};

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

  let gameState = props.state;
  let currentNegotiations: Record<string, unknown> = {};
  let currentTurn: number | null = null;
  let moves: TurnData[] = [];

  // WASM state
  let wasmEngine: WasmEngine | undefined;
  let wasmLoading = false;

  // Analysis mode state
  let analysisMode = false;
  let analysisEngine: WasmEngine | undefined;

  // DOM elements
  const gobanEl = document.getElementById("goban")!;
  const navButtons = findNavButtons("game-");
  const analyzeBtn = document.getElementById("analyze-btn") as HTMLButtonElement | null;
  const analysisControls = document.getElementById("game-analysis-controls");
  const gameControls = document.getElementById("game-controls");
  const analysisUndoBtn = document.getElementById("game-undo-btn") as HTMLButtonElement | null;
  const analysisPassBtn = document.getElementById("game-pass-btn") as HTMLButtonElement | null;
  const analysisResetBtn = document.getElementById("game-reset-btn") as HTMLButtonElement | null;
  const exitAnalysisBtn = document.getElementById("game-exit-analysis-btn") as HTMLButtonElement | null;

  function activeEngine(): WasmEngine | undefined {
    return analysisMode ? analysisEngine : wasmEngine;
  }

  async function loadWasm(): Promise<WasmEngine | undefined> {
    if (wasmEngine) {
      return wasmEngine;
    }
    if (wasmLoading) {
      return;
    }
    wasmLoading = true;
    try {
      const wasm = await ensureWasm();
      const eng = new wasm.WasmEngine(gameState.cols, gameState.rows);
      if (moves.length > 0) {
        eng.replace_moves(JSON.stringify(moves));
      }
      wasmEngine = eng;
      return eng;
    } catch (e) {
      console.error("Failed to load WASM engine", e);
      wasmLoading = false;
      return;
    }
  }

  function isNavigating(): boolean {
    return wasmEngine != null && !wasmEngine.is_at_latest();
  }

  function saveAnalysis() {
    if (analysisEngine) {
      localStorage.setItem(analysisStorageKey, analysisEngine.moves_json());
    }
  }

  async function enterAnalysis() {
    const wasm = await ensureWasm();

    analysisEngine = new wasm.WasmEngine(gameState.cols, gameState.rows);

    const saved = localStorage.getItem(analysisStorageKey);
    if (saved) {
      analysisEngine.replace_moves(saved);
      analysisEngine.to_latest();
    } else if (moves.length > 0) {
      analysisEngine.replace_moves(JSON.stringify(moves));
      analysisEngine.to_latest();
    }

    // Also ensure the game nav engine exists for when we exit
    if (!wasmEngine) {
      wasmEngine = new wasm.WasmEngine(gameState.cols, gameState.rows);
      if (moves.length > 0) {
        wasmEngine.replace_moves(JSON.stringify(moves));
      }
      wasmLoading = false;
    }

    analysisMode = true;

    if (analysisControls) { analysisControls.style.display = "flex"; }
    if (gameControls) { gameControls.style.display = "none"; }

    renderFromWasm();
  }

  function exitAnalysis() {
    analysisMode = false;
    analysisEngine = undefined;

    if (analysisControls) { analysisControls.style.display = "none"; }
    if (gameControls) { gameControls.style.display = ""; }

    if (isNavigating()) {
      renderFromWasm();
    } else {
      renderGoban(gameState);
      updateNavButtonsLocal();
    }
  }

  function resetAnalysis() {
    if (!analysisEngine) {
      return;
    }
    localStorage.removeItem(analysisStorageKey);
    if (moves.length > 0) {
      analysisEngine.replace_moves(JSON.stringify(moves));
    } else {
      analysisEngine.replace_moves("[]");
    }
    analysisEngine.to_latest();
    renderFromWasm();
  }

  function updateNavButtonsLocal() {
    const eng = activeEngine();
    if (eng) {
      updateNavButtonsShared(eng, navButtons);
    } else {
      const total = moves.length;
      if (navButtons.start) { navButtons.start.disabled = total === 0; }
      if (navButtons.back) { navButtons.back.disabled = total === 0; }
      if (navButtons.forward) { navButtons.forward.disabled = true; }
      if (navButtons.end) { navButtons.end.disabled = true; }
      if (navButtons.counter) {
        navButtons.counter.textContent = `Move ${total} / ${total}`;
      }
    }
  }

  function renderFromWasm() {
    const eng = activeEngine();
    if (!eng) {
      return;
    }

    let onVertexClick: ((evt: Event, position: Point) => void) | undefined;

    if (analysisMode) {
      onVertexClick = (_: Event, [col, row]: Point) => {
        if (analysisEngine && analysisEngine.try_play(col, row)) {
          saveAnalysis();
          renderFromWasm();
        }
      };
    }

    renderFromEngine(eng, gobanEl, onVertexClick);
    updateNavButtonsLocal();
  }

  async function navigate(action: "back" | "forward" | "start" | "end") {
    let eng: WasmEngine | undefined;

    if (analysisMode) {
      eng = analysisEngine;
    } else {
      eng = await loadWasm();
    }
    if (!eng) {
      return;
    }

    if (!navigateEngine(eng, action)) {
      return;
    }

    if (!analysisMode && eng.is_at_latest()) {
      renderGoban(gameState);
      updateNavButtonsLocal();
    } else {
      renderFromWasm();
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
          currentNegotiations = data.negotiations ?? {};
          currentTurn = data.current_turn_stone;
          moves = data.moves ?? [];

          console.debug("WebSocket: state updated", {
            currentState: gameState,
            currentTurn,
          });

          // Keep game nav engine in sync
          if (wasmEngine) {
            const wasAtLatest = wasmEngine.is_at_latest();
            wasmEngine.replace_moves(JSON.stringify(moves));
            if (wasAtLatest) {
              wasmEngine.to_latest();
            }
          }

          if (!analysisMode && !isNavigating()) {
            renderGoban(gameState);
          }
          if (!analysisMode) {
            updateNavButtonsLocal();
          }
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
            gameState = data.state;
            currentTurn = data.current_turn_stone ?? null;
            if (data.moves) {
              moves = data.moves;
              if (wasmEngine) {
                const wasAtLatest = wasmEngine.is_at_latest();
                wasmEngine.replace_moves(JSON.stringify(moves));
                if (wasAtLatest) {
                  wasmEngine.to_latest();
                }
              }
            }
            if (!analysisMode && !isNavigating()) {
              renderGoban(data.state);
            }
            if (!analysisMode) {
              updateNavButtonsLocal();
            }
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
    if (analysisMode || isNavigating()) {
      return;
    }
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
        vertexSize={computeVertexSize(gobanEl, cols, rows)}
        signMap={board}
        markerMap={markerMap}
        fuzzyStonePlacement
        animateStonePlacement
        onVertexClick={onVertexClick}
      />,
      gobanEl,
    );
  }

  window.addEventListener("resize", () => {
    if (analysisMode || isNavigating()) {
      renderFromWasm();
    } else {
      renderGoban(gameState);
    }
  });

  // Navigation button handlers
  navButtons.start?.addEventListener("click", () => navigate("start"));
  navButtons.back?.addEventListener("click", () => navigate("back"));
  navButtons.forward?.addEventListener("click", () => navigate("forward"));
  navButtons.end?.addEventListener("click", () => navigate("end"));

  // Analysis mode handlers
  analyzeBtn?.addEventListener("click", () => enterAnalysis());
  exitAnalysisBtn?.addEventListener("click", () => exitAnalysis());

  analysisUndoBtn?.addEventListener("click", () => {
    if (analysisEngine && analysisEngine.undo()) {
      saveAnalysis();
      renderFromWasm();
    }
  });

  analysisPassBtn?.addEventListener("click", () => {
    if (analysisEngine && analysisEngine.pass()) {
      saveAnalysis();
      renderFromWasm();
    }
  });

  analysisResetBtn?.addEventListener("click", () => resetAnalysis());

  setupKeyboardNav(
    (action) => navigate(action),
    () => {
      if (analysisMode) {
        exitAnalysis();
      }
    },
  );

  // Render initial board
  renderGoban(gameState);
  updateNavButtonsLocal();

  renderChatHistory();
  setupChat((text) => channel.say(text));

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

    // Hide undo controls during analysis mode
    if (analysisMode) {
      requestBtn.style.display = "none";
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
