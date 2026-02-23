import { render, createRef } from "preact";
import { GameStage, type InitialGameProps, type Sign } from "../goban/types";
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
  board,
  playerStone,
  initialProps as initialPropsSignal,
  estimateScore,
  showMoveTree,
  moveConfirmEnabled,
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

  initGameState(gameId, pStone, initialProps);

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
    showMoveTree.value = true;
    board.value?.setMoveTreeEl(moveTreeEl);
    board.value?.render();
    doRender();
  }

  function exitAnalysis() {
    pm.clear();
    analysisMode.value = false;
    if (board.value) {
      board.value.updateBaseMoves(JSON.stringify(moves.value));
    }
    showMoveTree.value = false;
    board.value?.setMoveTreeEl(null);
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
    onVertexClick: handleVertexClick,
    onStonePlay: playStoneSound,
    onPass: playPassSound,
    onRender: (engine, territoryInfo) => {
      // Auto-exit estimate when territory review gets cleared (e.g. by navigation)
      if (estimateMode.value && !territoryInfo.reviewing) {
        estimateMode.value = false;
        estimateScore.value = undefined;
      }
      // Capture estimate score for status display
      if (estimateMode.value && territoryInfo.score) {
        estimateScore.value = territoryInfo.score;
      }
      // Auto-enter analysis when navigating away from latest game move
      if (
        board.value &&
        !analysisMode.value &&
        !estimateMode.value &&
        engine.view_index() < moves.value.length
      ) {
        enterAnalysis();
      }
      doRender();
    },
  }).then((b) => {
    board.value = b;
    if (showMoveTree.value) {
      board.value.setMoveTreeEl(moveTreeEl);
    }
    if (moves.value.length > 0) {
      const movesJson = JSON.stringify(moves.value);
      resetMovesTracker(movesJson);
      board.value.updateBaseMoves(movesJson);
    }
    board.value.render();
    board.value.updateNav();
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
  };
  joinGame(gameId, (raw) => handleGameMessage(raw, deps));

  // --- Tab title flash ---
  document.addEventListener("visibilitychange", () => updateTurnFlash());
}
