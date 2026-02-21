import { GameStage, type InitialGameProps, type Point, type Sign } from "./goban/types";
import { createBoard, findNavButtons, type TerritoryOverlay } from "./board";
import { renderChatHistory, setupChat, type SenderResolver } from "./chat";
import { readShowCoordinates, setupCoordToggle } from "./coord-toggle";
import { readMoveConfirmation, setupMoveConfirmToggle } from "./move-confirm";
import { blackSymbol, whiteSymbol } from "./format";
import { joinGame } from "./live";
import { createGameContext } from "./game-context";
import { createGameChannel } from "./game-channel";
import { queryGameDom } from "./game-dom";
import { updateTitle, updatePlayerLabels, updateStatus, updateTurnFlash } from "./game-ui";
import { updateControls } from "./game-controls";
import { handleGameMessage } from "./game-messages";
import type { ClockState } from "./game-clock";
import { readUserData, derivePlayerStone } from "./game-util";
import { playStoneSound, playPassSound } from "./game-sound";
import { settingsToSgfTime } from "./format";
import { downloadSgf } from "./sgf-io";
import type { SgfMeta } from "./sgf-io";

export function liveGame(initialProps: InitialGameProps, gameId: number) {
  const userData = readUserData();
  const playerStone = derivePlayerStone(
    userData,
    initialProps.black,
    initialProps.white,
  );

  console.debug("InitialGameProps", initialProps);
  console.debug("UserData", userData, "playerStone", playerStone);

  const ctx = createGameContext(gameId, playerStone, initialProps);
  const channel = createGameChannel(gameId);
  const dom = queryGameDom();
  const clockState: ClockState = {
    data: undefined,
    syncedAt: 0,
    interval: undefined,
    timeoutFlagSent: false,
  };

  // --- Coordinate toggle ---
  const showCoordinates = readShowCoordinates();
  setupCoordToggle(() => ctx.board);

  // --- Move confirmation toggle ---
  let moveConfirmEnabled = readMoveConfirmation();
  setupMoveConfirmToggle((v) => {
    moveConfirmEnabled = v;
    ctx.premove = undefined;
    ctx.board?.render();
  });

  // --- Ghost stone (premove) getter ---
  function getGhostStone(): { col: number; row: number; sign: Sign } | undefined {
    if (!ctx.premove || ctx.analysisMode) {
      return undefined;
    }
    const [col, row] = ctx.premove;
    return { col, row, sign: ctx.playerStone as Sign };
  }

  // --- Server territory overlay getter ---
  function getServerTerritory(): TerritoryOverlay | undefined {
    if (ctx.gameStage !== GameStage.TerritoryReview || !ctx.territory) {
      return undefined;
    }
    const paintMap = ctx.territory.ownership.map((v) => (v === 0 ? null : v));
    const dimmedVertices: Point[] = ctx.territory.dead_stones.map(
      ([c, r]) => [c, r] as Point,
    );
    return { paintMap, dimmedVertices };
  }

  // --- WASM board (async) ---
  createBoard({
    cols: ctx.gameState.cols,
    rows: ctx.gameState.rows,
    handicap: initialProps.settings.handicap,
    showCoordinates,
    gobanEl: dom.goban,
    moveTreeEl: dom.moveTree,
    moveTreeDirection: "responsive",
    storageKey: ctx.analysisStorageKey,
    baseMoves: ctx.moves.length > 0 ? JSON.stringify(ctx.moves) : undefined,
    branchAtBaseTip: true,
    navButtons: findNavButtons(),
    buttons: { pass: dom.passBtn },
    ghostStone: getGhostStone,
    territoryOverlay: getServerTerritory,
    onVertexClick: (col, row) => handleVertexClick(col, row),
    onStonePlay: playStoneSound,
    onPass: playPassSound,
    onRender: (engine) => {
      // Auto-enter analysis when navigating away from latest game move
      if (!ctx.analysisMode && engine.view_index() < ctx.moves.length) {
        enterAnalysis();
      }
      updateControls(ctx, dom);
    },
  }).then((b) => {
    ctx.board = b;
    if (b.restoredWithAnalysis) {
      enterAnalysis();
    }
    // Sync any moves that arrived from WS while board was loading.
    // ctx.movesJson stays "[]" so syncBoardMoves will also trigger
    // when WS state arrives later — merge_base_moves is idempotent.
    if (ctx.moves.length > 0) {
      const latestMovesJson = JSON.stringify(ctx.moves);
      if (latestMovesJson !== ctx.movesJson) {
        ctx.movesJson = latestMovesJson;
        ctx.board.updateBaseMoves(latestMovesJson);
        ctx.board.save();
        if (ctx.analysisMode) {
          ctx.premove = undefined;
          ctx.analysisMode = false;
        }
      }
    }
    ctx.board.render();
    ctx.board.updateNav();
    updateControls(ctx, dom);
  });

  // --- Analysis helpers (stay here — tightly coupled to orchestrator) ---
  function enterAnalysis() {
    ctx.premove = undefined;
    ctx.analysisMode = true;
    updateControls(ctx, dom);
    if (ctx.board) {
      ctx.board.render();
    }
  }

  function exitAnalysis(replaceBaseMoves = false) {
    ctx.premove = undefined;
    ctx.analysisMode = false;
    if (ctx.board) {
      if (replaceBaseMoves) {
        ctx.board.updateBaseMoves(JSON.stringify(ctx.moves));
      }
      if (ctx.board.baseTipNodeId >= 0) {
        ctx.board.engine.navigate_to(ctx.board.baseTipNodeId);
      } else {
        ctx.board.engine.to_start();
      }
      ctx.board.render();
    }
    updateControls(ctx, dom);
  }

  function handleVertexClick(col: number, row: number): boolean {
    if (ctx.analysisMode) {
      return false;
    }
    if (!ctx.board || !ctx.board.engine.is_at_latest()) {
      return false;
    }
    if (ctx.playerStone === 0) {
      return false;
    }
    if (ctx.gameStage === GameStage.TerritoryReview) {
      channel.toggleChain(col, row);
      return true;
    }
    const isMyTurn = ctx.currentTurn === ctx.playerStone;
    if (isMyTurn) {
      if (!moveConfirmEnabled) {
        ctx.premove = undefined;
        channel.play(col, row);
      } else if (ctx.premove && ctx.premove[0] === col && ctx.premove[1] === row) {
        // Confirm: same position clicked twice
        ctx.premove = undefined;
        channel.play(col, row);
      } else {
        // Show ghost stone at clicked position
        ctx.premove = [col, row];
        ctx.board.render();
      }
    } else {
      // Premoves disabled for now
      // if (ctx.premove && ctx.premove[0] === col && ctx.premove[1] === row) {
      //   ctx.premove = undefined;
      // } else {
      //   ctx.premove = [col, row];
      // }
      // ctx.board.render();
      return false;
    }
    return true;
  }

  // --- Chat sender resolver ---
  const resolveSender: SenderResolver = (userId) => {
    if (userId == null) {
      return "⚑";
    }
    const isBlack = ctx.black?.id === userId;
    const isWhite = ctx.white?.id === userId;
    const name = (isBlack ? ctx.black : isWhite ? ctx.white : undefined)
      ?.display_name ?? "?";
    const symbol = isBlack ? blackSymbol() : isWhite ? whiteSymbol() : "?";
    return `${name} ${symbol}`;
  };

  // --- WebSocket ---
  const deps = {
    ctx, dom, clockState, channel, resolveSender,
    onNewMove: () => {
      if (ctx.analysisMode) {
        exitAnalysis(true);
      }
    },
  };
  joinGame(gameId, (raw) => handleGameMessage(raw, deps));

  // --- Event listeners ---
  dom.passBtn?.addEventListener("click", (e) => {
    if (!ctx.analysisMode) {
      e.stopImmediatePropagation();
      document.getElementById("pass-confirm")?.showPopover();
    }
  });

  (
    document.getElementById("confirm-pass-btn") as HTMLButtonElement | null
  )?.addEventListener("click", () => channel.pass());
  (
    document.getElementById("confirm-resign-btn") as HTMLButtonElement | null
  )?.addEventListener("click", () => channel.resign());
  (
    document.getElementById("confirm-abort-btn") as HTMLButtonElement | null
  )?.addEventListener("click", () => channel.abort());

  dom.acceptTerritoryBtn?.addEventListener("click", () => {
    document.getElementById("accept-territory-confirm")?.showPopover();
  });
  (
    document.getElementById(
      "confirm-accept-territory-btn",
    ) as HTMLButtonElement | null
  )?.addEventListener("click", () => channel.approveTerritory());

  dom.analyzeBtn?.addEventListener("click", () => enterAnalysis());
  dom.exitAnalysisBtn?.addEventListener("click", () => exitAnalysis());

  // --- SGF export ---
  (document.getElementById("sgf-export") as HTMLButtonElement | null)
    ?.addEventListener("click", () => {
      if (!ctx.board) {
        return;
      }
      const timeFields = settingsToSgfTime(initialProps.settings);
      const meta: SgfMeta = {
        cols: ctx.gameState.cols,
        rows: ctx.gameState.rows,
        komi: initialProps.komi,
        handicap: initialProps.settings.handicap || undefined,
        black_name: ctx.black?.display_name,
        white_name: ctx.white?.display_name,
        result: ctx.result ?? undefined,
        game_name: undefined,
        time_limit_secs: timeFields.time_limit_secs,
        overtime: timeFields.overtime,
      };
      const sgf = ctx.board.engine.export_sgf(JSON.stringify(meta));
      const bName = ctx.black?.display_name ?? "Black";
      const wName = ctx.white?.display_name ?? "White";
      downloadSgf(sgf, `${bName}-vs-${wName}.sgf`);
    });

  dom.confirmMoveBtn?.addEventListener("click", () => {
    if (ctx.premove) {
      const [col, row] = ctx.premove;
      ctx.premove = undefined;
      channel.play(col, row);
      updateControls(ctx, dom);
    }
  });

  dom.requestUndoBtn?.addEventListener("click", () => {
    channel.requestUndo();
    dom.requestUndoBtn!.disabled = true;
  });
  document
    .getElementById("accept-undo-btn")
    ?.addEventListener("click", () => channel.acceptUndo());
  document
    .getElementById("reject-undo-btn")
    ?.addEventListener("click", () => channel.rejectUndo());

  // --- Tab title flash ---
  document.addEventListener("visibilitychange", () => updateTurnFlash(ctx));

  // --- Initial render ---
  updateTitle(ctx, dom.title);
  updatePlayerLabels(ctx, dom.playerTop, dom.playerBottom);
  updateStatus(ctx, dom.status);
  updateControls(ctx, dom);

  renderChatHistory(resolveSender);
  setupChat((text) => channel.say(text));
}
