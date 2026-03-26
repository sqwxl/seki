import { render, createRef } from "preact";
import { effect } from "@preact/signals";
import type { Sign } from "../goban/types";
import { GameStage, type InitialGameProps } from "../game/types";
import { createBoard, computeVertexSize } from "../goban/create-board";
import { Goban } from "../goban";
import type { ChatEntry } from "../components/chat";
import { readShowCoordinates } from "../utils/coord-toggle";
import {
  createMoveConfirm,
  handleMoveConfirmClick,
  dismissMoveConfirmOnClickOutside,
} from "../utils/move-confirm";
import { storage, gameAnalysisKey } from "../utils/storage";
import { settingsToSgfTime, todayYYYYMMDD } from "../utils/format";
import { joinGame, subscribe, subscribePresence } from "../ws";
import { createGameChannel } from "../game/channel";
import { updateTurnFlash, stopFlashing, updateTitle } from "../game/ui";
import type { TerritoryCountdown } from "../game/ui";
import { handleGameMessage, resetMovesTracker } from "../game/messages";
import type { ClockState } from "../game/clock";
import { readUserData, derivePlayerStone } from "../game/util";
import { createNotificationState } from "../game/notifications";
import { markRead } from "../game/unread";
import { playStoneSound, playPassSound } from "../game/sound";
import { downloadSgf } from "../utils/sgf";
import type { SgfMeta } from "../utils/sgf";
import type { UserData } from "../game/types";
import {
  initGameState,
  gameState,
  gameStage,
  currentTurn,
  moves,
  black,
  white,
  result,
  territory,
  settledTerritory,
  chatMessages,
  replaceChatMessages,
  analysisMode,
  estimateMode,
  opponentDisconnected,
  onlineUsers,
  board,
  playerStone,
  currentUserId,
  initialProps as initialPropsSignal,
  estimateScore,
  boardFinalized,
  boardFinalizedScore,
  boardReviewing,
  showCoordinates,
  moveConfirmEnabled,
  presentationActive,
  isPresenter,
  originatorId,
  navState,
  mobileTab,
  setPresence,
  resetGameRuntimeState,
  pendingMove,
  uiNowMs,
} from "../game/state";
import {
  gamePhase,
  toAnalysis,
  toLive,
  toEstimate,
  exitEstimate as phaseExitEstimate,
  toPresentation,
  toPresentationLocalAnalysis,
  toPresentationSyncedViewer,
  resetPhase,
} from "../game/phase";
import { LiveGamePage, getServerTerritory } from "./live-game-page";

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

  type SavedAnalysis = {
    tree: string;
    nodeId: number;
    active?: boolean;
  };

  function readSavedAnalysis(): SavedAnalysis | undefined {
    return storage.getJson<SavedAnalysis>(analysisKey);
  }

  function saveAnalysis(active?: boolean) {
    if (!board.value) {
      return;
    }
    const nextActive = active ?? analysisMode.value;
    if (analysisMode.value || nextActive) {
      storage.setJson(analysisKey, {
        tree: board.value.engine.tree_json(),
        nodeId: board.value.engine.current_node_id(),
        active: nextActive,
      });
      return;
    }

    const saved = readSavedAnalysis();
    if (saved) {
      storage.setJson(analysisKey, { ...saved, active: nextActive });
    }
  }

  function loadSavedAnalysisTree(): SavedAnalysis | undefined {
    if (!board.value) {
      return undefined;
    }
    const saved = readSavedAnalysis();
    if (!saved?.tree) {
      return saved;
    }
    board.value.engine.replace_tree(saved.tree);
    if (moves.value.length > 0) {
      board.value.engine.merge_base_moves(JSON.stringify(moves.value));
    }
    return saved;
  }

  /** Navigate to the last saved analysis position (tree is already loaded). */
  function restoreAnalysisPosition(saved = readSavedAnalysis()): void {
    if (!board.value || !saved) {
      return;
    }
    if (saved.nodeId >= 0) {
      board.value.engine.navigate_to(saved.nodeId);
    } else {
      board.value.engine.to_start();
    }
  }

  // --- Mode transition helpers ---

  function enterAnalysis({ restorePosition = true } = {}) {
    const cur = gamePhase.value;
    clearPendingMove();
    if (cur.phase === "presentation" && cur.role === "synced-viewer") {
      toPresentationLocalAnalysis();
    } else {
      toAnalysis();
    }
    const saved = loadSavedAnalysisTree();
    if (restorePosition) {
      restoreAnalysisPosition(saved);
    }
    board.value?.setMoveTreeEl(moveTreeEl);
    board.value?.render();
  }

  function exitAnalysis() {
    if (gamePhase.value.phase === "estimate") {
      doExitEstimate();
    }
    clearPendingMove();
    saveAnalysis(false);
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
      // Static overlay for finished games — just toggle and re-render
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
  // Always stores the latest snapshot from the presenter, even while in local
  // analysis, so we can re-sync when exiting personal analysis.
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

  // Static preview only helps on empty boards; on populated boards it makes the
  // eventual WASM handoff visibly jumpier because the preview and engine render
  // have different timing and placement state.
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
      boardFinalized.value = territoryInfo.finalized;
      boardFinalizedScore.value = territoryInfo.finalized
        ? territoryInfo.score
        : undefined;
      boardReviewing.value = territoryInfo.reviewing;
      // Auto-exit estimate when territory review gets cleared (e.g. by navigation)
      if (estimateMode.value && !territoryInfo.reviewing) {
        phaseExitEstimate();
        estimateScore.value = undefined;
      }
      // Auto-enter estimate when board enters territory review in analysis
      // (e.g. passing twice or navigating to a territory review node)
      if (
        analysisMode.value &&
        territoryInfo.reviewing &&
        !estimateMode.value
      ) {
        toEstimate();
      }
      // Capture estimate score for status display
      if (estimateMode.value && territoryInfo.score) {
        estimateScore.value = territoryInfo.score;
      }
      // Auto-enter analysis when navigating away from latest game move
      // or onto a variation branch (e.g. clicking a variation in the move tree)
      // (skip for presentation viewers — their board is driven by snapshots)
      if (
        board.value &&
        !analysisMode.value &&
        !estimateMode.value &&
        (engine.view_index() < moves.value.length ||
          !engine.is_on_main_line()) &&
        !(presentationActive.value && !isPresenter.value)
      ) {
        enterAnalysis({ restorePosition: false });
      }
      // Broadcast snapshot to viewers when presenting
      if (presentationActive.value && isPresenter.value) {
        broadcastSnapshot();
      }
      // Persist analysis tree on every render so branches survive refresh
      saveAnalysis();
      // Update nav state signal so Preact re-renders the controls
      navState.value = {
        atStart: engine.is_at_start(),
        atLatest: engine.is_at_latest(),
        atMainEnd: engine.is_at_main_end(),
        counter: `${engine.view_index()}`,
        boardTurnStone: engine.current_turn_stone(),
        boardLastMoveWasPass: engine.last_move_was_pass(),
      };
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
    // Mark the base tip as settled for games that ended via territory
    if (settledTerritory.value) {
      board.value.markSettled(settledTerritory.value.dead_stones);
    }
    // Always restore the saved tree so analysis branches persist across refreshes.
    const saved = readSavedAnalysis();
    if (saved?.active) {
      // Page was refreshed while in analysis — restore exact position
      enterAnalysis();
    } else if (saved && saved.active !== false && result.value) {
      // Completed game with saved analysis (and user didn't explicitly exit)
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
  // Seed from initial props so we only notify on genuinely new moves.
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
    onPresentationStarted: (snapshot: string) => {
      if (isPresenter.value) {
        clearPendingMove();
        toPresentation("presenter");
        restoreAnalysisPosition();
        board.value?.setMoveTreeEl(moveTreeEl);
      } else {
        // Clean up any active mode before syncing with presentation
        const wasInEstimate = estimateMode.value;
        const wasInAnalysis = analysisMode.value;
        if (wasInEstimate) {
          estimateScore.value = undefined;
          board.value?.exitTerritoryReview();
        }
        if (wasInAnalysis) {
          clearPendingMove();
          saveAnalysis();
        }
        toPresentation("synced-viewer");
        if (snapshot) {
          lastPresentationSnapshot = snapshot;
          board.value?.importSnapshot(snapshot);
        }
      }
      board.value?.render();
    },
    onPresentationEnded: (wasPresenter: boolean) => {
      lastPresentationSnapshot = "";
      if (wasPresenter) {
        // Presenter: exit analysis (also clears estimate if active)
        exitAnalysis();
      } else {
        const cur = gamePhase.value;
        if (cur.phase === "presentation" && cur.role === "local-analysis") {
          // Local-analysis viewer: transition to standalone analysis
          toAnalysis();
        } else {
          // Synced viewer: reset to live at final position
          toLive();
          if (board.value) {
            board.value.updateBaseMoves(JSON.stringify(moves.value));
            board.value.navigate("end");
            board.value.render();
          }
        }
      }
    },
    onPresentationUpdate: (snapshot: string) => {
      // Always cache the latest snapshot for re-sync on analysis exit
      lastPresentationSnapshot = snapshot;
      // Only import if we're a synced viewer (not presenter, not in personal analysis)
      if (!isPresenter.value && !analysisMode.value) {
        board.value?.importSnapshot(snapshot);
        // Overwrite viewer's stored analysis with the presentation tree
        try {
          const parsed = JSON.parse(snapshot) as {
            tree?: string;
            activeNodeId?: string;
          };
          if (parsed.tree) {
            storage.setJson(analysisKey, {
              tree: parsed.tree,
              nodeId: parseInt(parsed.activeNodeId ?? "-1", 10),
            });
          }
        } catch {
          // Ignore parse failures
        }
      }
    },
    onControlChanged: (newPresenterId: number) => {
      if (newPresenterId === currentUserId.value) {
        // We just became the presenter
        const wasAnalysis = analysisMode.value;
        toPresentation("presenter");
        if (!wasAnalysis) {
          clearPendingMove();
          restoreAnalysisPosition();
          board.value?.setMoveTreeEl(moveTreeEl);
        }
      } else {
        // We lost control — exit to synced viewer
        const wasInEstimate = estimateMode.value;
        if (wasInEstimate) {
          estimateScore.value = undefined;
          board.value?.exitTerritoryReview();
        }
        clearPendingMove();
        saveAnalysis();
        toPresentation("synced-viewer");
        if (lastPresentationSnapshot && board.value) {
          board.value.importSnapshot(lastPresentationSnapshot);
        }
      }
      board.value?.render();
    },
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
  disposers.push(effect(() => {
    const enabled = moveConfirmEnabled.value;
    mc.enabled = enabled;
    if (!enabled && mc.value) {
      clearPendingMove();
      board.value?.render();
    }
  }));

  // --- Disconnect countdown timer ---
  disposers.push(effect(() => {
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
  }));

  // --- Territory countdown timer ---
  disposers.push(effect(() => {
    const terr = territory.value;
    if (!terr?.expires_at) {
      return;
    }
    const interval = setInterval(() => {
      uiNowMs.value = Date.now();
    }, 1000);
    uiNowMs.value = Date.now();
    return () => clearInterval(interval);
  }));

  // --- Re-render board when returning from Chat tab ---
  disposers.push(effect(() => {
    if (mobileTab.value !== "chat" && board.value) {
      requestAnimationFrame(() => {
        board.value?.render();
      });
    }
  }));

  disposers.push(effect(() => {
    initialPropsSignal.value.creator_id;
    black.value;
    white.value;
    gameStage.value;
    result.value;
    moves.value.length;
    updateTitle();
  }));

  // --- Sync analysis mode with mobile tab ---
  disposers.push(effect(() => {
    const tab = mobileTab.value;
    if (tab === "analysis" && !analysisMode.peek()) {
      enterAnalysis();
    } else if (tab === "board" && analysisMode.peek()) {
      exitAnalysis();
    }
  }));

  // --- Tab title flash on visibility change ---
  const onVisibilityChange = () => {
    if (!document.hidden) {
      // Stop flashing when returning to tab; starting only happens on new moves
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
