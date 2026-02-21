import { isPlayStage, type IncomingMessage } from "./goban/types";
import type { GameCtx } from "./game-context";
import type { GameDomElements } from "./game-dom";
import type { GameChannel } from "./game-channel";
import type { ClockState } from "./game-clock";
import { syncClock } from "./game-clock";
import { updateControls } from "./game-controls";
import { updateTitle, updatePlayerLabels, updateStatus } from "./game-ui";
import { appendToChat, updateChatPresence, type SenderResolver } from "./chat";
import { playStoneSound } from "./game-sound";

export type GameMessageDeps = {
  ctx: GameCtx;
  dom: GameDomElements;
  clockState: ClockState;
  channel: GameChannel;
  resolveSender: SenderResolver;
};

function syncBoardMoves(
  ctx: GameCtx,
  playEffects: boolean,
  gobanEl: HTMLElement,
): void {
  if (!ctx.board) {
    return;
  }
  const newMovesJson = JSON.stringify(ctx.moves);
  if (newMovesJson !== ctx.movesJson) {
    if (playEffects) {
      const lastMove = ctx.moves[ctx.moves.length - 1];
      if (lastMove?.kind === "play") {
        playStoneSound();
      } else if (lastMove?.kind === "pass") {
        flashPassEffect(gobanEl);
      }
    }
    ctx.movesJson = newMovesJson;
    ctx.board.updateBaseMoves(ctx.movesJson, !ctx.analysisMode);
  }
  if (!ctx.analysisMode && ctx.board.engine.is_at_latest()) {
    ctx.board.render();
  }
  ctx.board.updateNav();
}

export function handleGameMessage(
  raw: Record<string, unknown>,
  deps: GameMessageDeps,
): void {
  const data = raw as IncomingMessage;
  const { ctx, dom, clockState, channel, resolveSender } = deps;

  console.debug("Game message:", data);

  switch (data.kind) {
    case "state": {
      ctx.gameState = data.state;
      ctx.gameStage = data.stage;
      ctx.currentTurn = data.current_turn_stone;
      ctx.moves = data.moves ?? [];
      ctx.undoRejected = data.undo_rejected;
      ctx.allowUndo = data.allow_undo ?? false;
      ctx.result = data.result;
      ctx.territory = data.territory;
      ctx.settledScore = data.score;
      ctx.black = data.black ?? undefined;
      ctx.white = data.white ?? undefined;
      if (data.online_users) {
        ctx.onlineUsers = new Set(data.online_users);
      }

      syncBoardMoves(ctx, true, dom.goban);
      updateControls(ctx, dom);
      updateTitle(ctx, dom.title);
      updatePlayerLabels(ctx, dom.playerTop, dom.playerBottom);
      updateStatus(ctx, dom.status);
      syncClock(clockState, data.clock, ctx, dom, () => channel.timeoutFlag());
      updateChatPresence(ctx.onlineUsers);

      if (!isPlayStage(ctx.gameStage)) {
        ctx.premove = undefined;
      } else if (
        ctx.premove &&
        ctx.currentTurn === ctx.playerStone
      ) {
        const [col, row] = ctx.premove;
        ctx.premove = undefined;
        if (ctx.gameState.board[row * ctx.gameState.cols + col] === 0) {
          channel.play(col, row);
        }
        if (ctx.board && !ctx.analysisMode && ctx.board.engine.is_at_latest()) {
          ctx.board?.render();
        }
      }
      break;
    }
    case "chat": {
      appendToChat(
        {
          user_id: data.player_id,
          text: data.text,
          move_number: data.move_number,
          sent_at: data.sent_at,
        },
        resolveSender,
      );
      updateChatPresence(ctx.onlineUsers);
      break;
    }
    case "error": {
      showError(data.message);
      break;
    }
    case "undo_accepted":
    case "undo_rejected": {
      hideUndoResponseControls();
      ctx.premove = undefined;
      if (data.undo_rejected !== undefined) {
        ctx.undoRejected = data.undo_rejected;
      }
      if (data.state) {
        ctx.gameState = data.state;
        ctx.currentTurn = data.current_turn_stone ?? null;
        if (data.moves) {
          ctx.moves = data.moves;
          syncBoardMoves(ctx, false, dom.goban);
        }
        updateControls(ctx, dom);
        updateStatus(ctx, dom.status);
      }
      break;
    }
    case "undo_request_sent": {
      if (dom.requestUndoBtn) {
        dom.requestUndoBtn.disabled = true;
      }
      break;
    }
    case "undo_response_needed": {
      showUndoResponseControls();
      break;
    }
    case "presence": {
      if (data.online) {
        ctx.onlineUsers.add(data.player_id);
      } else {
        ctx.onlineUsers.delete(data.player_id);
      }
      updatePlayerLabels(ctx, dom.playerTop, dom.playerBottom);
      updateChatPresence(ctx.onlineUsers);
      break;
    }
    default: {
      console.warn("Unknown game message kind:", data);
      break;
    }
  }
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

export function flashPassEffect(goban: HTMLElement): void {
  goban.classList.remove("goban-pass-flash");
  // Force reflow so re-adding the class restarts the animation
  void goban.offsetWidth;
  goban.classList.add("goban-pass-flash");
  goban.addEventListener("animationend", () => {
    goban.classList.remove("goban-pass-flash");
  }, { once: true });
}
