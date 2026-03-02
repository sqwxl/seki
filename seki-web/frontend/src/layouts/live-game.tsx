import { render, createRef } from "preact";
import { effect } from "@preact/signals";
import type { Sign } from "../goban/types";
import { GameStage, type InitialGameProps } from "../game/types";
import { createBoard, computeVertexSize } from "../goban/create-board";
import { Goban } from "../goban";
import type { ChatEntry } from "../components/chat";
import { readShowCoordinates } from "../utils/coord-toggle";
import { createPremove } from "../utils/premove";
import { settingsToSgfTime } from "../utils/format";
import { joinGame } from "../ws";
import { createGameChannel } from "../game/channel";
import { updateTurnFlash, updateTitle } from "../game/ui";
import type { TerritoryCountdown } from "../game/ui";
import { handleGameMessage, resetMovesTracker } from "../game/messages";
import type { ClockState } from "../game/clock";
import { readUserData, derivePlayerStone } from "../game/util";
import { createNotificationState } from "../game/notifications";
import { markRead } from "../game/unread";
import { playStoneSound, playPassSound } from "../game/sound";
import { downloadSgf } from "../utils/sgf";
import type { SgfMeta } from "../utils/sgf";
import type { CoordsToggleState } from "../utils/shared-controls";
import {
  initGameState,
  gameState,
  gameStage,
  currentTurn,
  moves,
  black,
  white,
  result,
  settledTerritory,
  chatMessages,
  analysisMode,
  estimateMode,
  opponentDisconnected,
  board,
  playerStone,
  currentUserId,
  initialProps as initialPropsSignal,
  estimateScore,
  showMoveTree,
  moveConfirmEnabled,
  presentationActive,
  isPresenter,
  navState,
  mobileTab,
} from "../game/state";
import { LiveGamePage, getServerTerritory } from "./live-game-page";

export function liveGame(
  initialProps: InitialGameProps,
  gameId: number,
  root: HTMLElement,
) {
  const userData = readUserData();
  const pStone = derivePlayerStone(
    userData,
    initialProps.black,
    initialProps.white,
  );

  console.debug("InitialGameProps", initialProps);
  console.debug("UserData", userData, "playerStone", pStone);

  initGameState(gameId, userData?.id ?? 0, pStone, initialProps);

  const channel = createGameChannel(gameId);
  const gobanRef = createRef<HTMLDivElement>();
  const clockState: ClockState = {
    data: undefined,
    syncedAt: 0,
    interval: undefined,
    timeoutFlagSent: false,
  };
  const territoryCountdown: TerritoryCountdown = {
    deadline: undefined,
    interval: undefined,
    flagSent: false,
    chatEntry: undefined,
  };
  const coordsState: CoordsToggleState = {
    showCoordinates: readShowCoordinates(),
  };
  const pm = createPremove({
    getSign: () => playerStone.value as Sign,
  });
  moveConfirmEnabled.value = pm.enabled;

  // --- Move tree element ---
  const moveTreeEl = document.createElement("div");
  moveTreeEl.className = "move-tree";

  // --- Mode transition helpers ---
  function enterAnalysis() {
    pm.clear();
    analysisMode.value = true;
    board.value?.setMoveTreeEl(moveTreeEl);
    board.value?.render();
    doRender();
  }

  function exitAnalysis() {
    if (estimateMode.value) {
      exitEstimate();
    }
    pm.clear();
    analysisMode.value = false;
    if (board.value) {
      // Sync to active presentation, or fall back to base game moves
      if (
        presentationActive.value &&
        !isPresenter.value &&
        lastPresentationSnapshot
      ) {
        board.value.importSnapshot(lastPresentationSnapshot);
      } else {
        board.value.updateBaseMoves(JSON.stringify(moves.value));
      }
    }
    showMoveTree.value = false;
    mobileTab.value = "board";
    board.value?.render();
    doRender();
  }

  function enterEstimate() {
    pm.clear();
    estimateMode.value = true;
    if (settledTerritory.value && !analysisMode.value) {
      // Static overlay for finished games — just toggle and re-render
      board.value?.render();
      doRender();
    } else {
      board.value?.enterTerritoryReview();
    }
  }

  function exitEstimate() {
    estimateMode.value = false;
    estimateScore.value = undefined;
    if (settledTerritory.value && !analysisMode.value) {
      board.value?.render();
      doRender();
    } else {
      board.value?.exitTerritoryReview();
      doRender();
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
    downloadSgf(sgf, `${bName}-vs-${wName}.sgf`);
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
      channel.toggleChain(col, row);
      return true;
    }
    const isMyTurn = currentTurn.value === playerStone.value;
    if (isMyTurn) {
      if (!pm.enabled) {
        pm.clear();
        channel.play(col, row);
      } else if (pm.value && pm.value[0] === col && pm.value[1] === row) {
        pm.clear();
        channel.play(col, row);
      } else {
        pm.value = [col, row];
        board.value.render();
        doRender();
      }
    }
    return true;
  }

  // --- Parse initial chat history ---
  const chatLogRaw = root.dataset.chatLog;
  if (chatLogRaw) {
    chatMessages.value = JSON.parse(chatLogRaw) as ChatEntry[];
  }

  // --- Render ---
  function doRender() {
    render(
      <LiveGamePage
        channel={channel}
        pm={pm}
        coordsState={coordsState}
        moveTreeEl={moveTreeEl}
        gobanRef={gobanRef}
        enterAnalysis={enterAnalysis}
        exitAnalysis={exitAnalysis}
        enterEstimate={enterEstimate}
        exitEstimate={exitEstimate}
        handleSgfExport={handleSgfExport}
        enterPresentation={enterPresentation}
        exitPresentation={exitPresentation}
      />,
      root,
    );
    updateTitle();
  }

  // Initial render (before board loads)
  doRender();

  // Static board preview while WASM loads
  if (gobanRef.current) {
    const gs = gameState.value;
    render(
      <Goban
        cols={gs.cols}
        rows={gs.rows}
        vertexSize={computeVertexSize(
          gobanRef.current,
          gs.cols,
          gs.rows,
          coordsState.showCoordinates,
        )}
        signMap={gs.board}
        showCoordinates={coordsState.showCoordinates}
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
    return pm.getGhostStone();
  }

  // --- WASM board (async) ---
  createBoard({
    cols: gameState.value.cols,
    rows: gameState.value.rows,
    handicap: initialProps.settings.handicap,
    showCoordinates: coordsState.showCoordinates,
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
      // Auto-exit estimate when territory review gets cleared (e.g. by navigation)
      if (estimateMode.value && !territoryInfo.reviewing) {
        estimateMode.value = false;
        estimateScore.value = undefined;
      }
      // Auto-enter estimate when board enters territory review in analysis
      // (e.g. passing twice or navigating to a territory review node)
      if (
        analysisMode.value &&
        territoryInfo.reviewing &&
        !estimateMode.value
      ) {
        estimateMode.value = true;
      }
      // Capture estimate score for status display
      if (estimateMode.value && territoryInfo.score) {
        estimateScore.value = territoryInfo.score;
      }
      // Auto-enter analysis when navigating away from latest game move
      // (skip for presentation viewers — their board is driven by snapshots)
      if (
        board.value &&
        !analysisMode.value &&
        !estimateMode.value &&
        engine.view_index() < moves.value.length &&
        !(presentationActive.value && !isPresenter.value)
      ) {
        enterAnalysis();
      }
      // Broadcast snapshot to viewers when presenting
      if (presentationActive.value && isPresenter.value) {
        broadcastSnapshot();
      }
      // Update nav state signal so Preact re-renders the controls
      navState.value = {
        atStart: engine.is_at_start(),
        atLatest: engine.is_at_latest(),
        atMainEnd: engine.is_at_main_end(),
        counter: `${engine.view_index()}`,
      };
      doRender();
    },
  }).then((b) => {
    board.value = b;
    board.value.setMoveTreeEl(moveTreeEl);
    if (moves.value.length > 0) {
      const movesJson = JSON.stringify(moves.value);
      resetMovesTracker(movesJson);
      board.value.updateBaseMoves(movesJson);
    }
    board.value.render();
    doRender();
  });

  // --- Notifications ---
  const notificationState = createNotificationState();

  // --- WebSocket ---
  const deps = {
    gobanEl: () => gobanRef.current,
    clockState,
    territoryCountdown,
    channel,
    premove: pm,
    notificationState,
    onNewMove: () => {
      if (analysisMode.value) {
        exitAnalysis();
      }
      if (estimateMode.value) {
        exitEstimate();
      }
    },
    onPresentationStarted: (snapshot: string) => {
      if (isPresenter.value) {
        enterAnalysis();
      } else {
        // Exit personal analysis to sync with the presentation.
        // Handles the reconnect race where auto-analysis fires before
        // presentationActive is set by the later presentation_started message.
        if (analysisMode.value) {
          exitAnalysis();
        }
        if (snapshot) {
          lastPresentationSnapshot = snapshot;
          board.value?.importSnapshot(snapshot);
        }
      }
      doRender();
    },
    onPresentationEnded: (wasPresenter: boolean) => {
      lastPresentationSnapshot = "";
      if (wasPresenter) {
        // Presenter: exit analysis (also clears estimate if active)
        exitAnalysis();
      } else if (!analysisMode.value && board.value) {
        // Synced viewer: reset board to base game state
        board.value.updateBaseMoves(JSON.stringify(moves.value));
        board.value.render();
      }
      // Viewers in personal analysis: unaffected
      doRender();
    },
    onPresentationUpdate: (snapshot: string) => {
      // Always cache the latest snapshot for re-sync on analysis exit
      lastPresentationSnapshot = snapshot;
      // Only import if we're a synced viewer (not presenter, not in personal analysis)
      if (!isPresenter.value && !analysisMode.value) {
        board.value?.importSnapshot(snapshot);
      }
    },
    onControlChanged: (newPresenterId: number) => {
      if (newPresenterId === currentUserId.value) {
        // We just became the presenter
        if (!analysisMode.value) {
          enterAnalysis();
        }
      } else if (analysisMode.value) {
        // We lost control — exit analysis so we sync with the new presenter
        exitAnalysis();
      }
      doRender();
    },
  };
  markRead(gameId);
  joinGame(gameId, (raw) => handleGameMessage(raw, deps));

  // --- Disconnect abort timer ---
  // Re-render after each possible abort threshold so the button appears
  effect(() => {
    const dc = opponentDisconnected.value;
    if (!dc) {
      return;
    }
    const elapsed = Date.now() - dc.since.getTime();
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const threshold of [15_000, 30_000]) {
      const delay = threshold - elapsed + 100;
      if (delay > 0) {
        timers.push(setTimeout(() => doRender(), delay));
      }
    }
    // If both thresholds already passed, render now
    if (timers.length === 0) {
      doRender();
    }
    return () => timers.forEach(clearTimeout);
  });

  // --- Re-render board when returning from Chat tab ---
  effect(() => {
    if (mobileTab.value !== "chat" && board.value) {
      requestAnimationFrame(() => {
        board.value?.render();
      });
    }
  });

  // --- Sync analysis mode with mobile tab ---
  effect(() => {
    const tab = mobileTab.value;
    if (tab === "analysis" && !analysisMode.peek()) {
      showMoveTree.value = true;
      enterAnalysis();
    } else if (tab === "board" && analysisMode.peek()) {
      exitAnalysis();
    }
  });

  // --- Tab title flash ---
  document.addEventListener("visibilitychange", () => updateTurnFlash());
}
