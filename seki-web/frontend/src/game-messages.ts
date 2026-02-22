import { isPlayStage, type IncomingMessage } from "./goban/types";
import type { GameCtx } from "./game-context";
import type { GameDomElements } from "./game-dom";
import type { GameChannel } from "./game-channel";
import type { ClockState } from "./game-clock";
import { syncClock } from "./game-clock";
import type { PremoveState } from "./premove";
import { updateTitle, updateStatus, updateTurnFlash, syncTerritoryCountdown } from "./game-ui";
import type { TerritoryCountdown } from "./game-ui";
import { notifyTurn, type NotificationState } from "./game-notifications";
import { appendToChat, updateChatPresence, type SenderResolver } from "./chat";
import { playStoneSound, playPassSound } from "./game-sound";

export type GameMessageDeps = {
  ctx: GameCtx;
  dom: GameDomElements;
  clockState: ClockState;
  territoryCountdown: TerritoryCountdown;
  channel: GameChannel;
  premove: PremoveState;
  notificationState: NotificationState;
  resolveSender: SenderResolver;
  renderLabels: () => void;
  renderControls: () => void;
  onNewMove?: () => void;
};

function syncBoardMoves(
  ctx: GameCtx,
  playEffects: boolean,
  gobanEl: HTMLElement,
  onNewMove?: () => void,
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
        playPassSound();
        flashPassEffect(gobanEl);
      }
    }
    ctx.movesJson = newMovesJson;
    ctx.board.updateBaseMoves(ctx.movesJson);
    ctx.board.save();
    onNewMove?.();
  }
  if (!ctx.analysisMode) {
    ctx.board.render();
  }
  ctx.board.updateNav();
}

export function handleGameMessage(
  raw: Record<string, unknown>,
  deps: GameMessageDeps,
): void {
  const data = raw as IncomingMessage;
  const { ctx, dom, clockState, territoryCountdown, channel, premove, notificationState, resolveSender, onNewMove } = deps;

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

      syncBoardMoves(ctx, true, dom.goban, onNewMove);
      deps.renderControls();
      updateTitle(ctx, dom.title);
      deps.renderLabels();
      updateStatus(ctx, dom.status);
      updateTurnFlash(ctx);
      notifyTurn(ctx, notificationState);
      syncClock(clockState, data.clock, ctx, () => channel.timeoutFlag(), deps.renderLabels);
      syncTerritoryCountdown(
        territoryCountdown,
        ctx.territory?.expires_at,
        ctx,
        dom.status,
        () => channel.territoryTimeoutFlag(),
      );
      updateChatPresence(ctx.onlineUsers);

      if (!isPlayStage(ctx.gameStage)) {
        premove.clear();
      } else if (
        premove.value &&
        ctx.currentTurn === ctx.playerStone
      ) {
        const [col, row] = premove.value;
        premove.clear();
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
      premove.clear();
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
        deps.renderControls();
        deps.renderLabels();
        updateStatus(ctx, dom.status);
      }
      break;
    }
    case "undo_request_sent": {
      // Controls will re-render with updated undo button state
      deps.renderControls();
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
      deps.renderLabels();
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
