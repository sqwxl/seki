import { effect } from "@preact/signals";
import { createRef, render } from "preact";
import type { ChatEntry } from "../components/chat";
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
import { computeVertexSize, createBoard } from "../goban/create-board";
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
    getSign: () => playerStone.value as Sign,
  });
  moveConfirmEnabled.value = mc.enabled;
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

  // Imported from sidebar.tsx: readSavedAnalysis, saveAnalysis, loadSavedAnalysisTree, restoreAnalysisPosition

  // --- Mode transition helpers ---

  function enterAnalysis({ restorePosition = true } = {}) {
    const cur = gamePhase.value;
    clearPendingMove();
    if (cur.phase === "presentation" && cur.role === "synced-viewer") {
      toPresentationLocalAnalysis();
    } else {
      toAnalysis();
    }
    const saved = loadSavedAnalysisTree(board.value, analysisKey, moves.value);
    if (restorePosition) {
      restoreAnalysisPosition(board.value, saved);
    }
    board.value?.setMoveTreeEl(moveTreeEl);
    board.value?.render();
  }

  function exitAnalysis() {
    if (gamePhase.value.phase === "estimate") {
      doExitEstimate();
    }
    clearPendingMove();
    saveAnalysis(board.value, analysisMode.value, analysisKey, false);
    const cur = gamePhase.value;
    if (cur.phase === "presentation" && cur.role === "local-analysis") {
      toPresentationSyncedViewer();
      if (lastPresentationSnapshot && board.value) {
        board.value.importSnapshot(lastPresentationSnapshot);
      }
    } else {
      toLive();
      board.value?.navigate("main-end");
    }
    mobileTab.value = "board";
    board.value?.render();
  }

  function enterEstimate() {
    const wasAnalysis = analysisMode.value;
    clearPendingMove();
    toEstimate();
    if (settledTerritory.value && !wasAnalysis) {
      board.value?.render();
    } else {
      board.value?.enterTerritoryReview();
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
      return false;
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
        } else {
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
    if (analysisMode.value || estimateMode.value) {
      return undefined;
    }
    return mc.getGhostStone();
  }

  // --- WASM board (async) ---
  createBoard({
    cols: gameState.value.cols,
    rows: gameState.value.rows,
    handicap: initialProps.settings.handicap,
    showCoordinates: showCoordinates.value,
    gobanEl: gobanRef.current!,
    ghostStone,
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
    onVertexClick: handleVertexClick,
    onStonePlay: playStoneSound,
    onPass: playPassSound,
    onRender: (engine, territoryInfo) => {
      onRenderCallback(engine, territoryInfo, {
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
        navState,
        broadcastSnapshot,
        saveAnalysis: (active) =>
          saveAnalysis(board.value, analysisMode.value, analysisKey, active),
        enterAnalysis,
        exitEstimateFn: doExitEstimate,
        enterEstimateFn: enterEstimate,
      });
    },
  }).then((b) => {
    if (disposed) {
      b.destroy();
      return;
    }
    board.value = b;
    board.value.setMoveTreeEl(moveTreeEl);
    if (moves.value.length > 0) {
      const movesJson = JSON.stringify(moves.value);
      resetMovesTracker(moves.value.length);
      board.value.updateBaseMoves(movesJson);
    }
    if (settledTerritory.value) {
      board.value.markSettled(settledTerritory.value.dead_stones);
    }
    const saved = readSavedAnalysis(analysisKey);
    if (saved?.active) {
      enterAnalysis();
    } else if (saved && saved.active !== false && result.value) {
      enterAnalysis();
    } else {
      board.value.navigate("main-end");
    }
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
      saveAnalysis: (active) =>
        saveAnalysis(board.value, analysisMode.value, analysisKey, active),
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

  // --- Re-render board when returning from Chat tab ---
  disposers.push(
    effect(() => {
      if (mobileTab.value !== "chat" && board.value) {
        requestAnimationFrame(() => {
          board.value?.render();
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
        enterAnalysis();
      } else if (tab === "board" && analysisMode.peek()) {
        exitAnalysis();
      }
    }),
  );

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
    territoryCountdown.interval && clearInterval(territoryCountdown.interval);
    clockState.interval && clearInterval(clockState.interval);
    board.value?.destroy();
    resetPhase();
    resetGameRuntimeState();
    render(null, root);
  };
}
