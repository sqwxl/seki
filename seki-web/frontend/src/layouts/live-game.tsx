import { effect, signal, untracked } from "@preact/signals";
import { createRef, render } from "preact";
import { analyzePositionDirect } from "../ai/analyze";
import { aiPositionFromEngine } from "../ai/position";
import type { ChatEntry } from "../components/chat";
import { liveGameControlsState } from "../game/capabilities";
import { createGameChannel } from "../game/channel";
import type { ClockState } from "../game/clock";
import { handleGameMessage, resetMovesTracker } from "../game/messages";
import { createNotificationState } from "../game/notifications";
import {
  gamePhase,
  exitEstimate as phaseExitEstimate,
  resetPhase,
  toAnalysis,
  toEstimate,
  toLive,
  toPresentationLocalAnalysis,
  toPresentationSyncedViewer,
} from "../game/phase";
import { playPassSound, playStoneSound } from "../game/sound";
import {
  analysisMode,
  black,
  board,
  boardFinalized,
  boardFinalizedScore,
  boardReviewing,
  currentTurn,
  estimateMode,
  estimatePending,
  estimateScore,
  gameStage,
  gameState,
  initGameState,
  initialProps as initialPropsSignal,
  isPresenter,
  mobileTab,
  moveConfirmEnabled,
  moves,
  navState,
  onlineUsers,
  opponentDisconnected,
  originatorId,
  pendingMove,
  playerStone,
  pregameSettings,
  presentationActive,
  replaceChatMessages,
  resetGameRuntimeState,
  result,
  setPresence,
  settledTerritory,
  showCoordinates,
  territory,
  uiNowMs,
  white,
} from "../game/state";
import type { UserData } from "../game/types";
import { GameStage, type InitialGameProps } from "../game/types";
import type { TerritoryCountdown } from "../game/ui";
import { stopFlashing, updateTitle } from "../game/ui";
import { markRead } from "../game/unread";
import { derivePlayerStone, readUserData } from "../game/util";
import { Goban } from "../goban";
import {
  computeVertexSize,
  createBoard,
  type TerritoryInfo,
} from "../goban/create-board";
import type { Sign } from "../goban/types";
import { readShowCoordinates } from "../utils/coord-toggle";
import { settingsToSgfTime, todayYYYYMMDD } from "../utils/format";
import {
  createMoveConfirm,
  dismissMoveConfirmOnClickOutside,
  handleMoveConfirmClick,
} from "../utils/move-confirm";
import type { SgfMeta } from "../utils/sgf";
import { downloadSgf } from "../utils/sgf";
import { gameAnalysisKey } from "../utils/storage";
import { joinGame, subscribe } from "../ws";
import {
  createAnalysisSessionController,
  type AnalysisAiState,
  type AnalysisEstimateState,
} from "./analysis-session/controller";
import { LiveGamePage, getServerTerritory } from "./live-game-page";
import { onRenderCallback } from "./live-game/board-section";
import { buildWebSocketDeps } from "./live-game/game-info";
import {
  loadSavedAnalysisTree,
  readSavedAnalysis,
  restoreAnalysisPosition,
  saveAnalysis,
} from "./live-game/sidebar";

export function liveGame(
  initialProps: InitialGameProps,
  gameId: number,
  root: HTMLElement,
  initialChatLog: ChatEntry[] = [],
) {
  let disposed = false;
  let aiTerritoryRequestId = 0;
  let aiTerritoryNodeId: number | undefined;
  let aiTerritoryOwnership: number[] | undefined;
  const userData = readUserData();
  const pStone = derivePlayerStone(
    userData,
    initialProps.black,
    initialProps.white,
  );

  console.debug("InitialGameProps", initialProps);
  console.debug("UserData", userData, "playerStone", pStone);

  resetPhase();
  resetGameRuntimeState();
  initGameState(gameId, userData?.id ?? 0, pStone, initialProps);

  if (window.location.hash === "#chat") {
    mobileTab.value = "chat";
  }

  const clockState: ClockState = {
    data: undefined,
    syncedAt: 0,
    interval: undefined,
    timeoutFlagSent: false,
  };
  const channel = createGameChannel(gameId, () => {
    if (clockState.syncedAt <= 0) {
      return undefined;
    }

    return performance.now() - clockState.syncedAt;
  });

  const gobanRef = createRef<HTMLDivElement>();
  const territoryCountdown: TerritoryCountdown = {
    deadline: undefined,
    interval: undefined,
    flagSent: false,
    chatEntry: undefined,
  };

  showCoordinates.value = readShowCoordinates();

  const mc = createMoveConfirm({
    getSign: () => {
      if (analysisMode.value) {
        return (board.value?.engine.current_turn_stone() ?? 1) as Sign;
      }

      return playerStone.value as Sign;
    },
  });

  moveConfirmEnabled.value = mc.enabled;

  const liveAnalysisAiState = signal<AnalysisAiState>({
    enabled: false,
    pending: false,
  });
  const liveAnalysisEstimateState = signal<AnalysisEstimateState>({
    pending: false,
  });
  const liveAnalysisTerritoryInfo = signal<TerritoryInfo>({
    estimating: false,
    reviewing: false,
    confirming: false,
    finalized: false,
    score: undefined,
  });
  const analysisSession = createAnalysisSessionController({
    state: {
      board,
      pendingMove,
      ai: liveAnalysisAiState,
      estimate: liveAnalysisEstimateState,
      territoryInfo: liveAnalysisTerritoryInfo,
      nav: navState,
    },
    moveConfirm: mc,
    getKomi: () => initialProps.komi,
    canUseAi: () => !!result.value || playerStone.value === 0,
    onPlaySound: playStoneSound,
    onPassSound: playPassSound,
    onClearVariations: clearLiveAnalysisVariations,
    onRender: (currentBoard, territoryInfo) => {
      onRenderCallback(currentBoard.engine, territoryInfo, {
        board,
        analysisMode,
        estimateMode,
        moves,
        boardFinalized,
        boardFinalizedScore,
        boardReviewing,
        estimateScore,
        presentationActive,
        isPresenter,
        broadcastSnapshot,
        saveAnalysis: saveAnalysisIfChanged,
        enterAnalysis,
        exitEstimateFn: doExitEstimate,
        enterEstimateFn: enterEstimate,
      });
    },
  });

  const disposers: Array<() => void> = [];

  // --- Move tree element ---
  const moveTreeEl = document.createElement("div");
  moveTreeEl.className = "move-tree";

  function syncPendingMove() {
    pendingMove.value = mc.value;
  }

  function clearPendingMove() {
    mc.clear();
    pendingMove.value = undefined;
  }

  // --- Analysis persistence helpers ---
  const analysisKey = gameAnalysisKey(gameId);
  let lastSavedAnalysisSignature: string | undefined;

  // Imported from sidebar.tsx: readSavedAnalysis, saveAnalysis, loadSavedAnalysisTree, restoreAnalysisPosition

  function saveAnalysisIfChanged() {
    const currentBoard = board.value;

    if (!currentBoard || !analysisMode.value) {
      return;
    }

    const signature = `${currentBoard.engine.current_node_id()}:${currentBoard.engine.tree_node_count()}`;

    if (signature === lastSavedAnalysisSignature) {
      return;
    }

    lastSavedAnalysisSignature = signature;
    saveAnalysis(currentBoard, true, analysisKey);
  }

  function clearLiveAnalysisVariations() {
    const currentBoard = board.value;

    if (!currentBoard) {
      return;
    }

    currentBoard.restoreBaseMoves();
    lastSavedAnalysisSignature = undefined;
    saveAnalysisIfChanged();
    currentBoard.render();
  }

  // --- Mode transition helpers ---

  function enterAnalysis({
    restorePosition = true,
    nodeId,
  }: { restorePosition?: boolean; nodeId?: number } = {}) {
    const cur = gamePhase.value;
    const alreadyAnalysis = analysisMode.value;
    const carryEstimate = cur.phase === "estimate" && !cur.fromAnalysis;
    clearPendingMove();

    if (carryEstimate) {
      doExitEstimate();
    }

    if (!alreadyAnalysis) {
      if (cur.phase === "presentation" && cur.role === "synced-viewer") {
        toPresentationLocalAnalysis();
      } else {
        toAnalysis();
      }
    }

    mobileTab.value = "analysis";

    // Tree is already loaded by the page setup path — just restore the
    // analysis position if needed. Avoid replace_tree here because it
    // would clobber the _baseTipNodeId set by updateBaseMoves.
    const saved = restorePosition ? readSavedAnalysis(analysisKey) : undefined;

    if (nodeId != null && board.value) {
      if (nodeId >= 0) {
        board.value.engine.navigate_to(nodeId);
      } else {
        board.value.engine.to_start();
      }
    } else if (restorePosition) {
      restoreAnalysisPosition(board.value, saved);
    }

    board.value?.setMoveTreeEl(moveTreeEl);
    if (
      !alreadyAnalysis ||
      nodeId != null ||
      restorePosition ||
      carryEstimate
    ) {
      board.value?.render();
    }

    if (carryEstimate) {
      analysisSession.toggleEstimate();
    }
  }

  function returnToLiveMainline(renderMode: "full" | "board-only" = "full") {
    toLive();
    if (renderMode === "board-only") {
      board.value?.navigateBoardOnly("main-end");
    } else {
      board.value?.navigate("main-end");
    }
  }

  function exitAnalysis({
    renderMode = "full",
  }: { renderMode?: "full" | "board-only" } = {}) {
    if (gamePhase.value.phase === "estimate") {
      doExitEstimate();
    }

    const cur = gamePhase.value;
    const wasAnalysis = analysisMode.value;
    const carryEstimate =
      analysisEstimateActive() && cur.phase !== "presentation";

    if (!wasAnalysis && !carryEstimate) {
      return;
    }

    if (analysisEstimateActive()) {
      analysisSession.clearEstimate();
      board.value?.exitTerritoryReview();
    }
    analysisSession.clearAiSuggestion(false);
    clearPendingMove();
    saveAnalysisIfChanged();

    if (cur.phase === "presentation" && cur.role === "local-analysis") {
      toPresentationSyncedViewer();

      if (lastPresentationSnapshot && board.value) {
        board.value.importSnapshot(lastPresentationSnapshot);
      }
    } else {
      returnToLiveMainline(renderMode);
    }

    mobileTab.value = "board";

    if (carryEstimate) {
      void enterEstimate();
    }
  }

  function clearAiTerritoryOwnership() {
    aiTerritoryRequestId += 1;
    aiTerritoryNodeId = undefined;
    aiTerritoryOwnership = undefined;
    estimatePending.value = false;
  }

  function cancelAiTerritoryRequest() {
    aiTerritoryRequestId += 1;
    estimatePending.value = false;
  }

  function aiTerritoryOwnershipForBoard() {
    const currentBoard = board.value;
    const ownership = aiTerritoryOwnership;

    if (
      !currentBoard ||
      aiTerritoryNodeId !== currentBoard.engine.current_node_id() ||
      !ownership
    ) {
      return undefined;
    }

    const size = currentBoard.engine.cols() * currentBoard.engine.rows();

    if (ownership.length !== size) {
      return undefined;
    }

    return ownership.map((value) =>
      Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0,
    );
  }

  function analysisEstimateActive() {
    return (
      (liveAnalysisTerritoryInfo.value.estimating &&
        !liveAnalysisTerritoryInfo.value.confirming) ||
      liveAnalysisEstimateState.value.mode === "estimate"
    );
  }

  async function enterEstimate() {
    const wasAnalysis = analysisMode.value;
    const currentBoard = board.value;

    clearPendingMove();

    if (!currentBoard) {
      return;
    }

    if (wasAnalysis) {
      if (liveAnalysisEstimateState.value.mode === "review") {
        toEstimate();
        currentBoard.render();

        return;
      }

      analysisSession.toggleEstimate();

      return;
    }

    if (settledTerritory.value && !wasAnalysis) {
      clearAiTerritoryOwnership();
      toEstimate();
      currentBoard.render();

      return;
    }

    const nodeId = currentBoard.engine.current_node_id();
    const canUseAi =
      currentBoard.engine.cols() === 9 && currentBoard.engine.rows() === 9;
    const requestId = ++aiTerritoryRequestId;
    const cachedOwnership =
      aiTerritoryNodeId === nodeId ? aiTerritoryOwnership : undefined;

    if (!canUseAi) {
      aiTerritoryNodeId = undefined;
      aiTerritoryOwnership = undefined;
      estimatePending.value = false;
      toEstimate();
      currentBoard.enterEstimate();

      return;
    }

    if (cachedOwnership) {
      aiTerritoryNodeId = nodeId;
      aiTerritoryOwnership = cachedOwnership;
      estimatePending.value = false;
      toEstimate();
      currentBoard.enterEstimate();

      return;
    }

    aiTerritoryNodeId = nodeId;
    estimatePending.value = true;
    aiTerritoryOwnership = undefined;

    try {
      const position = aiPositionFromEngine(
        currentBoard.engine,
        initialProps.komi,
      );
      const aiResult = await analyzePositionDirect(position);
      const ownership = aiResult.analysis.ownership;

      if (requestId !== aiTerritoryRequestId) {
        return;
      }

      if (
        board.value !== currentBoard ||
        currentBoard.engine.current_node_id() !== nodeId
      ) {
        estimatePending.value = false;

        return;
      }

      estimatePending.value = false;
      aiTerritoryOwnership = ownership;
      toEstimate();
      currentBoard.enterEstimate();
    } catch {
      if (requestId !== aiTerritoryRequestId) {
        return;
      }

      if (
        board.value !== currentBoard ||
        currentBoard.engine.current_node_id() !== nodeId
      ) {
        estimatePending.value = false;

        return;
      }

      estimatePending.value = false;
      aiTerritoryNodeId = undefined;
      aiTerritoryOwnership = undefined;
      toEstimate();
      currentBoard.enterEstimate();
    }
  }

  function doExitEstimate() {
    const cur = gamePhase.value;

    if (cur.phase !== "estimate") {
      return;
    }

    const wasFromAnalysis = cur.fromAnalysis;
    phaseExitEstimate();
    estimateScore.value = undefined;
    cancelAiTerritoryRequest();
    analysisSession.clearEstimate();

    if (settledTerritory.value && !wasFromAnalysis) {
      board.value?.render();
    } else {
      board.value?.exitTerritoryReview();
    }
  }

  // --- Presentation snapshot cache ---
  let lastPresentationSnapshot = "";

  // --- Presentation helpers ---
  function broadcastSnapshot() {
    if (!board.value || !isPresenter.value) {
      return;
    }

    const snapshot = board.value.exportSnapshot();
    channel.sendPresentationState(snapshot);
  }

  function enterPresentation() {
    channel.startPresentation();
  }

  function exitPresentation() {
    channel.endPresentation();
  }

  function returnControl() {
    channel.giveControl(originatorId.value);
  }

  // --- SGF export ---
  function handleSgfExport() {
    if (!board.value) {
      return;
    }

    const timeFields = settingsToSgfTime(initialProps.settings);
    const meta: SgfMeta = {
      cols: gameState.value.cols,
      rows: gameState.value.rows,
      komi: initialPropsSignal.value.komi,
      handicap: initialProps.settings.handicap || undefined,
      black_name: black.value?.display_name,
      white_name: white.value?.display_name,
      result: result.value ?? undefined,
      game_name: undefined,
      time_limit_secs: timeFields.time_limit_secs,
      overtime: timeFields.overtime,
    };
    const sgf = board.value.engine.export_sgf(JSON.stringify(meta));
    const bName = black.value?.display_name ?? "Black";
    const wName = white.value?.display_name ?? "White";

    downloadSgf(sgf, `${todayYYYYMMDD()}-${bName}-vs-${wName}.sgf`);
  }

  // --- Vertex click handler ---
  function handleVertexClick(col: number, row: number): boolean {
    if (analysisMode.value) {
      return analysisSession.onVertexClick(col, row);
    }

    if (!board.value || !board.value.engine.is_at_latest()) {
      return true;
    }

    if (playerStone.value === 0) {
      return true;
    }

    if (result.value) {
      return true;
    }

    if (gameStage.value === GameStage.Challenge) {
      return true;
    }

    if (gameStage.value === GameStage.TerritoryReview) {
      const b = board.value?.engine.board();

      if (b && b[row * gameState.value.cols + col] !== 0) {
        channel.toggleChain(col, row);
      }

      return true;
    }

    const isMyTurn = currentTurn.value === playerStone.value;

    if (isMyTurn) {
      if (!mc.enabled) {
        if (!board.value.engine.is_legal(col, row)) {
          return true;
        }

        clearPendingMove();
        channel.play(col, row);
      } else {
        const action = handleMoveConfirmClick(
          mc,
          col,
          row,
          board.value.engine.is_legal(col, row),
        );
        if (action === "confirm") {
          syncPendingMove();
          channel.play(col, row);
        } else if (action === "set") {
          syncPendingMove();
          board.value.render();
        }
      }
    }

    return true;
  }

  // --- Parse initial chat history ---
  replaceChatMessages(initialChatLog);

  // Initial render (before board loads)
  render(
    <LiveGamePage
      channel={channel}
      mc={mc}
      moveTreeEl={moveTreeEl}
      gobanRef={gobanRef}
      enterAnalysis={enterAnalysis}
      exitAnalysis={exitAnalysis}
      enterEstimate={enterEstimate}
      exitEstimate={doExitEstimate}
      handleSgfExport={handleSgfExport}
      enterPresentation={enterPresentation}
      exitPresentation={exitPresentation}
      returnControl={returnControl}
      analysisSession={analysisSession}
    />,
    root,
  );

  if (gobanRef.current && !gameState.value.board.some((cell) => cell !== 0)) {
    const gs = gameState.value;
    render(
      <Goban
        cols={gs.cols}
        rows={gs.rows}
        vertexSize={computeVertexSize(
          gobanRef.current,
          gs.cols,
          gs.rows,
          showCoordinates.value,
        )}
        signMap={gs.board}
        showCoordinates={showCoordinates.value}
        fuzzyStonePlacement
      />,
      gobanRef.current,
    );
  }

  // --- Ghost stone getter ---
  function ghostStone() {
    if (estimateMode.value || analysisEstimateActive()) {
      return undefined;
    }

    return analysisMode.value
      ? analysisSession.getGhostStone()
      : mc.getGhostStone();
  }

  // --- WASM board (async) ---
  createBoard({
    cols: gameState.value.cols,
    rows: gameState.value.rows,
    handicap: pregameSettings.value?.handicap ?? initialProps.settings.handicap,
    showCoordinates: showCoordinates.value,
    gobanEl: gobanRef.current!,
    ghostStone,
    ghostStoneOverlay: analysisSession.aiGhostStoneOverlay,
    heatOverlay: analysisSession.aiHeatOverlay,
    territoryReviewOwnership: () =>
      analysisSession.aiTerritoryOwnership() ?? aiTerritoryOwnershipForBoard(),
    territoryOverlay: getServerTerritory,
    canPlay: () => {
      if (analysisMode.value) {
        return true;
      }

      if (playerStone.value === 0 || result.value) {
        return false;
      }

      if (gameStage.value === GameStage.Challenge) {
        return false;
      }

      return currentTurn.value === playerStone.value;
    },
    onNavigate: analysisSession.onNavigate,
    onVertexClick: handleVertexClick,
    onStonePlay: () => {
      if (analysisMode.value) {
        analysisSession.onStonePlay();
      } else {
        playStoneSound();
      }
    },
    onPass: () => {
      if (analysisMode.value) {
        analysisSession.onPass();
      } else {
        playPassSound();
      }
    },
    branchAtBaseTip: true,
    onTerritoryReviewStart: analysisSession.onTerritoryReviewStart,
    onRender: analysisSession.onRender,
  }).then((b) => {
    if (disposed) {
      b.destroy();
      return;
    }

    board.value = b;
    board.value.setMoveTreeEl(moveTreeEl);

    if (settledTerritory.value) {
      board.value.markSettled(settledTerritory.value.dead_stones);
    }

    const saved = readSavedAnalysis(analysisKey);

    if (saved?.tree) {
      loadSavedAnalysisTree(board.value, analysisKey, moves.value);
    }

    if (moves.value.length > 0) {
      const movesJson = JSON.stringify(moves.value);

      resetMovesTracker(moves.value);
      board.value.updateBaseMoves(movesJson);
    }

    board.value.navigate("main-end");
  });

  // --- Dismiss pending move confirmation on click outside goban ---
  const stopDismissOutside = dismissMoveConfirmOnClickOutside(
    mc,
    () => gobanRef.current,
    () => {
      pendingMove.value = undefined;
      board.value?.render();
    },
  );

  // --- Notifications ---
  const notificationState = createNotificationState();
  notificationState.lastNotifiedMoveCount = moves.value.length;

  // --- WebSocket ---
  const deps = {
    gobanEl: () => gobanRef.current,
    clockState,
    territoryCountdown,
    channel,
    pendingMove: {
      get value() {
        return mc.value;
      },
      set value(v) {
        mc.value = v;
        pendingMove.value = v;
      },
      get enabled() {
        return mc.enabled;
      },
      set enabled(v) {
        mc.enabled = v;
      },
      getGhostStone: () => mc.getGhostStone(),
      clear: () => {
        clearPendingMove();
      },
    },
    notificationState,
    onNewMove: () => {
      if (estimateMode.value) {
        doExitEstimate();
      }
    },
    ...buildWebSocketDeps({
      clearPendingMove,
      moveTreeEl,
      analysisKey,
      lastPresentationSnapshot: () => lastPresentationSnapshot,
      setLastPresentationSnapshot: (v: string) => {
        lastPresentationSnapshot = v;
      },
      saveAnalysis: saveAnalysisIfChanged,
      exitAnalysis,
      restoreAnalysisPosition: () => restoreAnalysisPosition(board.value),
    }),
  };
  markRead(gameId);
  const leaveGame = joinGame(gameId, (raw) => handleGameMessage(raw, deps));

  // --- Presence subscriptions (lobby-level, no game_id) ---
  const unsubPresenceState = subscribe<{ users: Record<string, boolean> }>(
    "presence_state",
    (data) => {
      const map = new Map<number, UserData>();

      for (const [idStr, online] of Object.entries(data.users)) {
        const id = Number(idStr);

        if (online) {
          const userData =
            black.value?.id === id
              ? black.value
              : white.value?.id === id
                ? white.value
                : undefined;

          if (userData) {
            map.set(id, userData);
          }
        }
      }
      onlineUsers.value = map;
    },
  );

  const unsubPresenceChanged = subscribe<{ user_id: number; online: boolean }>(
    "presence_changed",
    (data) => {
      const userData =
        black.value?.id === data.user_id
          ? black.value
          : white.value?.id === data.user_id
            ? white.value
            : undefined;
      setPresence(data.user_id, data.online, userData ?? undefined);

      if (data.online) {
        const myStone = playerStone.value;
        const oppId =
          myStone === 1
            ? white.value?.id
            : myStone === -1
              ? black.value?.id
              : undefined;

        if (oppId === data.user_id) {
          opponentDisconnected.value = undefined;
        }
      }
    },
  );

  // --- Sync move confirmation toggle with mc state ---
  disposers.push(
    effect(() => {
      const enabled = moveConfirmEnabled.value;
      mc.enabled = enabled;

      if (!enabled && mc.value) {
        clearPendingMove();
        board.value?.render();
      }
    }),
  );

  // --- Preview negotiated handicap stones before both players accept ---
  disposers.push(
    effect(() => {
      const b = board.value;

      if (!b || moves.value.length > 0) {
        return;
      }

      const handicap =
        pregameSettings.value?.handicap ??
        initialPropsSignal.value.settings.handicap;

      b.setHandicap(handicap);
      b.render();
    }),
  );

  // --- Disconnect countdown timer ---
  disposers.push(
    effect(() => {
      const dc = opponentDisconnected.value;

      if (!dc) {
        return;
      }

      if (dc.gone || dc.gracePeriodMs == null) {
        uiNowMs.value = Date.now();

        return;
      }

      const interval = setInterval(() => {
        uiNowMs.value = Date.now();
      }, 1000);

      uiNowMs.value = Date.now();

      return () => clearInterval(interval);
    }),
  );

  // --- Territory countdown timer ---
  disposers.push(
    effect(() => {
      const terr = territory.value;

      if (!terr?.expires_at) {
        return;
      }

      const interval = setInterval(() => {
        uiNowMs.value = Date.now();
      }, 1000);
      uiNowMs.value = Date.now();

      return () => clearInterval(interval);
    }),
  );

  // --- Repaint board when returning from Chat tab ---
  disposers.push(
    effect(() => {
      const tab = mobileTab.value;

      if (
        tab !== "chat" &&
        !(tab === "analysis" && !analysisMode.peek()) &&
        !(tab === "board" && analysisMode.peek()) &&
        board.value
      ) {
        requestAnimationFrame(() => {
          board.value?.renderBoardOnly();
        });
      }
    }),
  );

  disposers.push(
    effect(() => {
      initialPropsSignal.value.creator_id;
      black.value;
      white.value;
      gameStage.value;
      result.value;
      moves.value.length;
      updateTitle();
    }),
  );

  // --- Sync analysis mode with mobile tab ---
  disposers.push(
    effect(() => {
      const tab = mobileTab.value;

      if (tab === "analysis" && !analysisMode.peek()) {
        untracked(() => enterAnalysis());
      } else if (tab === "board" && analysisMode.peek()) {
        untracked(() => exitAnalysis({ renderMode: "board-only" }));
      }
    }),
  );

  // --- Keyboard shortcuts ---
  const handleKeyDown = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (document.querySelector(".confirm-popover")) return;

    const caps = liveGameControlsState.value;

    switch (e.key) {
      case "p":
        if (caps.passIsAnalysisPass) {
          analysisSession.pass();
        } else if (caps.showPass && caps.confirmPassRequired) {
          document.getElementById("pass-btn")?.click();
        }
        break;
      case "q":
        if (caps.showResign) {
          document.getElementById("resign-btn")?.click();
        }
        break;
      case "r":
        if (caps.canRematch) {
          document.getElementById("rematch-btn")?.click();
        }
        break;
      case "u":
        if (caps.undoTooltip && caps.canRequestUndo && !caps.showUndoResponse) {
          channel.requestUndo();
        }
        break;
      case "a":
        if (caps.canEnterAnalysis) {
          enterAnalysis();
        }
        break;
      case "e":
        if (analysisMode.value && caps.showEnterEstimate) {
          analysisSession.toggleEstimate();
        } else if (caps.showEnterEstimate && caps.canEnterEstimate) {
          enterEstimate();
        }
        break;
      case "Escape":
        if (analysisEstimateActive()) {
          analysisSession.toggleEstimate();
        } else if (estimateMode.value) {
          doExitEstimate();
        } else if (analysisMode.value) {
          exitAnalysis();
        }
        break;
    }
  };

  document.addEventListener("keydown", handleKeyDown);

  // --- Tab title flash on visibility change ---
  const onVisibilityChange = () => {
    if (!document.hidden) {
      stopFlashing();
    }
  };

  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    disposed = true;

    for (const dispose of disposers) {
      dispose();
    }

    stopDismissOutside();
    leaveGame();
    unsubPresenceState();
    unsubPresenceChanged();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    document.removeEventListener("keydown", handleKeyDown);
    territoryCountdown.interval && clearInterval(territoryCountdown.interval);
    clockState.interval && clearInterval(clockState.interval);
    board.value?.destroy();
    resetPhase();
    resetGameRuntimeState();
    render(null, root);
  };
}
