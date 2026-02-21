import { GameStage, isPlayStage } from "./goban/types";
import type { GameCtx } from "./game-context";
import type { GameDomElements } from "./game-dom";

export function updateControls(ctx: GameCtx, dom: GameDomElements): void {
  if (ctx.analysisMode) {
    if (dom.passBtn) {
      dom.passBtn.style.display = "";
      dom.passBtn.disabled = false;
    }
    if (dom.resignBtn) {
      dom.resignBtn.style.display = "none";
    }
    if (dom.requestUndoBtn) {
      dom.requestUndoBtn.style.display = "none";
    }
    if (dom.abortBtn) {
      dom.abortBtn.style.display = "none";
    }
    if (dom.analyzeBtn) {
      dom.analyzeBtn.style.display = "none";
    }
    if (dom.exitAnalysisBtn) {
      dom.exitAnalysisBtn.style.display = "";
    }
    return;
  }

  // Live mode
  const isPlay = isPlayStage(ctx.gameStage);
  const isReview = ctx.gameStage === GameStage.TerritoryReview;
  const isMyTurn = ctx.currentTurn === ctx.playerStone;

  if (dom.passBtn) {
    dom.passBtn.style.display = ctx.playerStone !== 0 && isPlay ? "" : "none";
    dom.passBtn.disabled = !isMyTurn;
  }
  if (dom.resignBtn) {
    dom.resignBtn.style.display = isPlay ? "" : "none";
  }
  if (dom.analyzeBtn) {
    dom.analyzeBtn.style.display = isReview ? "none" : "";
  }
  if (dom.exitAnalysisBtn) {
    dom.exitAnalysisBtn.style.display = "none";
  }

  if (dom.requestUndoBtn) {
    dom.requestUndoBtn.style.display = ctx.allowUndo && isPlay ? "" : "none";
    const canUndo =
      ctx.moves.length > 0 &&
      ctx.playerStone !== 0 &&
      ctx.currentTurn !== ctx.playerStone &&
      !ctx.undoRejected;

    dom.requestUndoBtn.disabled = !canUndo;
    if (ctx.undoRejected) {
      dom.requestUndoBtn.title = "Undo was rejected for this move";
    } else if (ctx.moves.length === 0) {
      dom.requestUndoBtn.title = "No moves to undo";
    } else if (ctx.currentTurn === ctx.playerStone) {
      dom.requestUndoBtn.title = "Cannot undo on your turn";
    } else {
      dom.requestUndoBtn.title = "Request to undo your last move";
    }
  }

  if (dom.acceptTerritoryBtn) {
    dom.acceptTerritoryBtn.style.display =
      isReview && ctx.playerStone !== 0 ? "" : "none";
    const alreadyApproved =
      (ctx.playerStone === 1 && ctx.territory?.black_approved) ||
      (ctx.playerStone === -1 && ctx.territory?.white_approved);
    dom.acceptTerritoryBtn.disabled = !!alreadyApproved;
  }

  if (dom.abortBtn) {
    const canAbort =
      ctx.playerStone !== 0 && ctx.moves.length === 0 && !ctx.result;
    dom.abortBtn.style.display = canAbort ? "" : "none";
  }
}
