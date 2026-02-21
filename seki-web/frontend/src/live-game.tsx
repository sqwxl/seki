import { GameStage, type InitialGameProps } from "./goban/types";
import { createBoard, findNavButtons } from "./wasm-board";
import { renderChatHistory, setupChat, type SenderResolver } from "./chat";
import { blackSymbol, whiteSymbol } from "./format";
import { joinGame } from "./live";
import { createGameContext } from "./game-context";
import { createGameChannel } from "./game-channel";
import { queryGameDom } from "./game-dom";
import { renderGoban } from "./game-render";
import { updateTitle, updatePlayerLabels, updateStatus } from "./game-ui";
import { updateControls } from "./game-controls";
import { handleGameMessage, flashPassEffect } from "./game-messages";
import type { ClockState } from "./game-clock";
import { readUserData, derivePlayerStone } from "./game-util";

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

  // --- WASM board (async) ---
  createBoard({
    cols: ctx.gameState.cols,
    rows: ctx.gameState.rows,
    handicap: initialProps.settings.handicap,
    gobanEl: dom.goban,
    moveTreeEl: dom.moveTree,
    moveTreeDirection: "responsive",
    storageKey: ctx.analysisStorageKey,
    baseMoves: ctx.moves.length > 0 ? JSON.stringify(ctx.moves) : undefined,
    navButtons: findNavButtons(),
    buttons: { reset: dom.resetBtn },
    onVertexClick: (col, row) => handleVertexClick(col, row),
    onRender: () => updateControls(ctx, dom),
  }).then((b) => {
    ctx.board = b;
    if (ctx.moves.length > 0) {
      ctx.board.updateBaseMoves(JSON.stringify(ctx.moves));
    }
    renderGoban(ctx, dom.goban, channel);
    ctx.board.updateNav();
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

  function exitAnalysis() {
    ctx.premove = undefined;
    ctx.analysisMode = false;
    if (ctx.board) {
      ctx.board.engine.to_latest();
      renderGoban(ctx, dom.goban, channel);
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
    } else {
      channel.play(col, row);
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
  const deps = { ctx, dom, clockState, channel, resolveSender };
  joinGame(gameId, (raw) => handleGameMessage(raw, deps));

  // --- Event listeners ---
  dom.passBtn?.addEventListener("click", () => {
    if (ctx.analysisMode) {
      if (ctx.board && ctx.board.engine.pass()) {
        localStorage.setItem(
          ctx.analysisStorageKey,
          ctx.board.engine.tree_json(),
        );
        ctx.board.render();
        flashPassEffect(dom.goban);
      }
    } else {
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

  window.addEventListener("resize", () => {
    if (!ctx.analysisMode && ctx.board && ctx.board.engine.is_at_latest()) {
      renderGoban(ctx, dom.goban, channel);
    }
  });

  // --- Initial render ---
  renderGoban(ctx, dom.goban, channel);
  updateTitle(ctx, dom.title);
  updatePlayerLabels(ctx, dom.playerTop, dom.playerBottom);
  updateStatus(ctx, dom.status);
  updateControls(ctx, dom);

  renderChatHistory(resolveSender);
  setupChat((text) => channel.say(text));
}
