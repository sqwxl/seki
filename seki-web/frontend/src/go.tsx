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
  const startBtn = document.getElementById("game-start-btn") as HTMLButtonElement | null;
  const backBtn = document.getElementById("game-back-btn") as HTMLButtonElement | null;
  const forwardBtn = document.getElementById("game-forward-btn") as HTMLButtonElement | null;
  const endBtn = document.getElementById("game-end-btn") as HTMLButtonElement | null;
  const moveCounter = document.getElementById("game-move-counter");
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
      const wasm = await import("/static/wasm/go_engine_wasm.js");
      await wasm.default();
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
    const wasm = await import("/static/wasm/go_engine_wasm.js");
    await wasm.default();

    analysisEngine = new wasm.WasmEngine(gameState.cols, gameState.rows);

    // Check localStorage for saved analysis first
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
      updateNavButtons();
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

  function updateNavButtons() {
    const eng = activeEngine();
    if (eng) {
      const atStart = eng.is_at_start();
      const atLatest = eng.is_at_latest();
      if (startBtn) { startBtn.disabled = atStart; }
      if (backBtn) { backBtn.disabled = atStart; }
      if (forwardBtn) { forwardBtn.disabled = atLatest; }
      if (endBtn) { endBtn.disabled = atLatest; }
      if (moveCounter) {
        moveCounter.textContent = `Move ${eng.view_index()} / ${eng.total_moves()}`;
      }
    } else {
      const total = moves.length;
      if (startBtn) { startBtn.disabled = total === 0; }
      if (backBtn) { backBtn.disabled = total === 0; }
      if (forwardBtn) { forwardBtn.disabled = true; }
      if (endBtn) { endBtn.disabled = true; }
      if (moveCounter) {
        moveCounter.textContent = `Move ${total} / ${total}`;
      }
    }
  }

  function renderFromWasm() {
    const eng = activeEngine();
    if (!eng) {
      return;
    }
    const board = [...eng.board()] as number[];
    const cols = eng.cols();
    const rows = eng.rows();
    const markerMap: (MarkerData | null)[] = Array(board.length).fill(null);

    if (eng.has_ko()) {
      const kc = eng.ko_col();
      const kr = eng.ko_row();
      markerMap[kr * cols + kc] = koMarker;
    }

    let onVertexClick: ((evt: Event, position: Point) => void) | undefined;

    if (analysisMode && eng.is_at_latest()) {
      onVertexClick = (_: Event, [col, row]: Point) => {
        if (analysisEngine && analysisEngine.try_play(col, row)) {
          saveAnalysis();
          renderFromWasm();
        }
      };
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

    updateNavButtons();
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

    switch (action) {
      case "back":
        if (!eng.back()) { return; }
        break;
      case "forward":
        if (!eng.forward()) { return; }
        break;
      case "start":
        eng.to_start();
        break;
      case "end":
        eng.to_latest();
        break;
    }

    if (!analysisMode && eng.is_at_latest()) {
      renderGoban(gameState);
      updateNavButtons();
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
            updateNavButtons();
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
              updateNavButtons();
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

  function vertexSize(cols: number, rows: number): number {
    const avail = gobanEl.clientWidth;
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

  window.addEventListener("resize", () => {
    if (analysisMode || isNavigating()) {
      renderFromWasm();
    } else {
      renderGoban(gameState);
    }
  });

  // Navigation button handlers
  startBtn?.addEventListener("click", () => navigate("start"));
  backBtn?.addEventListener("click", () => navigate("back"));
  forwardBtn?.addEventListener("click", () => navigate("forward"));
  endBtn?.addEventListener("click", () => navigate("end"));

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
    if (analysisEngine && analysisEngine.is_at_latest() && analysisEngine.pass()) {
      saveAnalysis();
      renderFromWasm();
    }
  });

  analysisResetBtn?.addEventListener("click", () => resetAnalysis());

  document.addEventListener("keydown", (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      return;
    }

    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        navigate("back");
        break;
      case "ArrowRight":
        e.preventDefault();
        navigate("forward");
        break;
      case "Home":
        e.preventDefault();
        navigate("start");
        break;
      case "End":
        e.preventDefault();
        navigate("end");
        break;
      case "Escape":
        if (analysisMode) {
          e.preventDefault();
          exitAnalysis();
        }
        break;
    }
  });

  // Render initial board
  renderGoban(gameState);
  updateNavButtons();

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
