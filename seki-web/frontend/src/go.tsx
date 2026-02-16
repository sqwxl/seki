import { render } from "preact";
import { Goban } from "./goban/index";
import {
  isPlayStage,
  type ClockData,
  type GameState,
  type IncomingMessage,
  type InitialGameProps,
  type MarkerData,
  type PlayerData,
  type Point,
  type TerritoryData,
  type TurnData,
} from "./goban/types";
import { createBoard, findNavButtons } from "./wasm-board";
import type { Board } from "./wasm-board";
import { appendToChat, renderChatHistory, setupChat } from "./chat";

const koMarker: MarkerData = { type: "triangle", label: "ko" };
const BLACK_SYMBOL = "●";
const WHITE_SYMBOL = "○";
const BLACK_CAPTURES_SYMBOL = "⚉";
const WHITE_CAPTURES_SYMBOL = "⚇";
const CHECKMARK = "✓";

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
    approveTerritory(): void {
      ws.send(JSON.stringify({ action: "approve_territory" }));
    },
    abort(): void {
      ws.send(JSON.stringify({ action: "abort" }));
    },
  };

  let gameState = props.state;
  let currentTurn: number | null = null;
  let moves: TurnData[] = [];
  let undoRejected = false;
  let allowUndo = false;
  let result: string | null = null;
  let territory: TerritoryData | undefined;
  let clockData: ClockData | undefined;
  let clockInterval: ReturnType<typeof setInterval> | undefined;

  // Analysis mode: when true, vertex clicks go to local engine; when false, live play via WS
  let analysisMode = false;

  // Board instance — created asynchronously
  let board: Board | undefined;

  // DOM elements
  const statusEl = document.getElementById("status");
  const titleEl = document.getElementById("game-title");
  const playerTopEl = document.getElementById("player-top");
  const playerBottomEl = document.getElementById("player-bottom");
  const gobanEl = document.getElementById("goban")!;
  const passBtn = document.getElementById(
    "pass-btn",
  ) as HTMLButtonElement | null;
  const resignBtn = document.getElementById(
    "resign-btn",
  ) as HTMLButtonElement | null;
  const requestUndoBtn = document.getElementById(
    "request-undo-btn",
  ) as HTMLButtonElement | null;
  const resetBtn = document.getElementById(
    "reset-btn",
  ) as HTMLButtonElement | null;
  const analyzeBtn = document.getElementById(
    "analyze-btn",
  ) as HTMLButtonElement | null;
  const exitAnalysisBtn = document.getElementById(
    "exit-analysis-btn",
  ) as HTMLButtonElement | null;
  const acceptTerritoryBtn = document.getElementById(
    "accept-territory-btn",
  ) as HTMLButtonElement | null;
  const abortBtn = document.getElementById(
    "abort-btn",
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
    if (gameState.stage === "territory_review") {
      return true;
    }

    return isPlayStage(gameState.stage) && currentTurn === playerStone;
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

  function renderGoban(state: GameState): void {
    if (state.board.length === 0) {
      return;
    }

    const { board: boardData, cols, rows, ko } = state;
    const isTerritoryReview = state.stage === "territory_review" && territory;

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

    if (!isTerritoryReview) {
      if (moves.length > 0) {
        const lastMove = moves[moves.length - 1];
        if (lastMove.kind === "play" && lastMove.pos) {
          const [col, row] = lastMove.pos;
          markerMap[row * cols + col] = { type: "circle" };
        }
      }

      if (ko != null) {
        markerMap[ko.pos[1] * cols + ko.pos[0]] = koMarker;
      }
    }

    let paintMap: (number | null)[] | undefined;
    let dimmedVertices: Point[] | undefined;

    if (isTerritoryReview && territory) {
      paintMap = territory.ownership.map((v) => (v === 0 ? null : v));
      dimmedVertices = territory.dead_stones.map(([c, r]) => [c, r] as Point);
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
        paintMap={paintMap}
        dimmedVertices={dimmedVertices}
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
    moveTreeEl: document.getElementById("move-tree"),
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

  function setLabel(el: HTMLElement, name: string, points: string): void {
    const nameEl = el.querySelector(".player-name");
    const pointsEl = el.querySelector(".player-captures");
    if (nameEl) {
      nameEl.textContent = name;
    }
    if (pointsEl) {
      pointsEl.textContent = points;
    }
  }

  function formatPoints(n: number): string {
    return n % 1 === 0 ? String(n) : n.toFixed(1);
  }

  function updatePlayerLabels(
    black: PlayerData | null,
    white: PlayerData | null,
  ): void {
    if (!playerTopEl || !playerBottomEl) {
      return;
    }
    const bName = `${BLACK_SYMBOL} ${black ? black.display_name : "…"}`;
    const wName = `${WHITE_SYMBOL} ${white ? white.display_name : "…"}`;

    let bPoints: number;
    let wPoints: number;
    if (territory) {
      bPoints = territory.score.black;
      wPoints = territory.score.white;
    } else {
      bPoints = gameState.captures.black;
      wPoints = gameState.captures.white + props.komi;
    }

    const bStr = `${formatPoints(bPoints)} ${BLACK_CAPTURES_SYMBOL}`;
    const wStr = `${formatPoints(wPoints)} ${WHITE_CAPTURES_SYMBOL}`;
    if (playerStone === -1) {
      setLabel(playerTopEl, bName, bStr);
      setLabel(playerBottomEl, wName, wStr);
    } else {
      setLabel(playerTopEl, wName, wStr);
      setLabel(playerBottomEl, bName, bStr);
    }
  }

  function updateStatus(): void {
    if (!statusEl) {
      return;
    }
    if (gameState.stage === "territory_review" && territory) {
      const bCheck = territory.black_approved ? ` ${CHECKMARK}` : "";
      const wCheck = territory.white_approved ? ` ${CHECKMARK}` : "";
      statusEl.textContent = `B: ${territory.score.black}${bCheck}  |  W: ${territory.score.white}${wCheck}`;
    } else {
      statusEl.textContent = "";
    }
  }

  function formatClock(ms: number, isCorrespondence: boolean): string {
    if (isCorrespondence) {
      const totalSecs = Math.max(0, Math.floor(ms / 1000));
      const days = Math.floor(totalSecs / 86400);
      const hours = Math.floor((totalSecs % 86400) / 3600);
      if (days > 0) {
        return `${days}d ${hours}h`;
      }
      const mins = Math.floor((totalSecs % 3600) / 60);
      return `${hours}h ${mins}m`;
    }
    const totalSecs = Math.max(0, Math.floor(ms / 1000));
    if (totalSecs < 10) {
      const tenths = Math.max(0, Math.floor(ms / 100)) / 10;
      return tenths.toFixed(1);
    }
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  function updateClocks(): void {
    if (!clockData) {
      // Hide clock elements for untimed games
      for (const el of document.querySelectorAll<HTMLElement>(".player-clock")) {
        el.textContent = "";
      }
      return;
    }

    const isCorr = clockData.type === "correspondence";
    const now = Date.now();
    const lastMoveAt = clockData.last_move_at
      ? new Date(clockData.last_move_at).getTime()
      : now;
    const elapsed = now - lastMoveAt;

    let blackMs = clockData.black.remaining_ms;
    let whiteMs = clockData.white.remaining_ms;

    if (clockData.active_stone === 1) {
      blackMs -= elapsed;
    } else if (clockData.active_stone === -1) {
      whiteMs -= elapsed;
    }

    const blackText = formatClock(blackMs, isCorr);
    const whiteText = formatClock(whiteMs, isCorr);

    const blackPeriods =
      clockData.type === "byoyomi" && clockData.black.periods > 0
        ? ` (${clockData.black.periods})`
        : "";
    const whitePeriods =
      clockData.type === "byoyomi" && clockData.white.periods > 0
        ? ` (${clockData.white.periods})`
        : "";

    if (playerTopEl && playerBottomEl) {
      const topClockEl = playerTopEl.querySelector<HTMLElement>(".player-clock");
      const bottomClockEl = playerBottomEl.querySelector<HTMLElement>(".player-clock");

      if (playerStone === -1) {
        // Black on top, white on bottom
        if (topClockEl) {
          topClockEl.textContent = blackText + blackPeriods;
          topClockEl.classList.toggle("low-time", blackMs < 10000);
        }
        if (bottomClockEl) {
          bottomClockEl.textContent = whiteText + whitePeriods;
          bottomClockEl.classList.toggle("low-time", whiteMs < 10000);
        }
      } else {
        // White on top, black on bottom
        if (topClockEl) {
          topClockEl.textContent = whiteText + whitePeriods;
          topClockEl.classList.toggle("low-time", whiteMs < 10000);
        }
        if (bottomClockEl) {
          bottomClockEl.textContent = blackText + blackPeriods;
          bottomClockEl.classList.toggle("low-time", blackMs < 10000);
        }
      }
    }
  }

  function syncClock(data: ClockData | undefined): void {
    clockData = data;
    if (clockInterval) {
      clearInterval(clockInterval);
      clockInterval = undefined;
    }
    if (clockData && clockData.active_stone) {
      updateClocks();
      clockInterval = setInterval(updateClocks, 100);
    } else {
      updateClocks();
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
          allowUndo = data.allow_undo ?? false;
          result = data.result;
          territory = data.territory;

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
          updatePlayerLabels(data.black, data.white);
          updateStatus();
          syncClock(data.clock);
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
          hideUndoResponseControls();
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
          if (requestUndoBtn) {
            requestUndoBtn.disabled = true;
          }
          break;
        case "undo_response_needed":
          showUndoResponseControls();
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
        localStorage.setItem(analysisStorageKey, board.engine.tree_json());
        board.render();
      }
    } else {
      document.getElementById("pass-confirm")?.showPopover();
    }
  });
  const confirmPassBtn = document.getElementById(
    "confirm-pass-btn",
  ) as HTMLButtonElement | null;
  confirmPassBtn?.addEventListener("click", () => channel.pass());
  const confirmResignBtn = document.getElementById(
    "confirm-resign-btn",
  ) as HTMLButtonElement | null;
  confirmResignBtn?.addEventListener("click", () => channel.resign());
  const confirmAbortBtn = document.getElementById(
    "confirm-abort-btn",
  ) as HTMLButtonElement | null;
  confirmAbortBtn?.addEventListener("click", () => channel.abort());

  // Territory review handlers
  acceptTerritoryBtn?.addEventListener("click", () => {
    document.getElementById("accept-territory-confirm")?.showPopover();
  });
  const confirmAcceptTerritoryBtn = document.getElementById(
    "confirm-accept-territory-btn",
  ) as HTMLButtonElement | null;
  confirmAcceptTerritoryBtn?.addEventListener("click", () =>
    channel.approveTerritory(),
  );

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
  updatePlayerLabels(props.black, props.white);
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
      if (passBtn) {
        passBtn.style.display = "";
      }
      if (resignBtn) {
        resignBtn.style.display = "none";
      }
      if (requestUndoBtn) {
        requestUndoBtn.style.display = "none";
      }
      if (abortBtn) {
        abortBtn.style.display = "none";
      }
      if (resetBtn) {
        resetBtn.style.display = "";
      }
      if (analyzeBtn) {
        analyzeBtn.style.display = "none";
      }
      if (exitAnalysisBtn) {
        exitAnalysisBtn.style.display = "";
      }
      return;
    }

    // Live mode
    const isPlay = isPlayStage(gameState.stage);
    const isReview = gameState.stage === "territory_review";

    const isMyTurn = currentTurn === playerStone;
    if (passBtn) {
      passBtn.style.display = playerStone !== 0 && isPlay ? "" : "none";
      passBtn.disabled = !isMyTurn;
    }
    if (resignBtn) {
      resignBtn.style.display = isPlay ? "" : "none";
    }
    if (resetBtn) {
      resetBtn.style.display = "none";
    }
    if (analyzeBtn) {
      analyzeBtn.style.display = isReview ? "none" : "";
    }
    if (exitAnalysisBtn) {
      exitAnalysisBtn.style.display = "none";
    }

    if (requestUndoBtn) {
      requestUndoBtn.style.display = allowUndo && isPlay ? "" : "none";
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

    if (acceptTerritoryBtn) {
      acceptTerritoryBtn.style.display =
        isReview && playerStone !== 0 ? "" : "none";
      const alreadyApproved =
        (playerStone === 1 && territory?.black_approved) ||
        (playerStone === -1 && territory?.white_approved);
      acceptTerritoryBtn.disabled = !!alreadyApproved;
    }

    if (abortBtn) {
      const canAbort =
        playerStone !== 0 && moves.length === 0 && !result;
      abortBtn.style.display = canAbort ? "" : "none";
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

function showUndoResponseControls(): void {
  const popover = document.getElementById("undo-response-controls");
  if (popover) {
    popover.showPopover();
  }
}

function hideUndoResponseControls(): void {
  const popover = document.getElementById("undo-response-controls");
  if (popover) {
    popover.hidePopover();
  }
}
