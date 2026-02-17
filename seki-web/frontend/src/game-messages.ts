import type { IncomingMessage } from "./goban/types";
import type { GameCtx } from "./game-context";
import type { GameDomElements } from "./game-dom";
import type { GameChannel } from "./game-channel";
import type { ClockState } from "./game-clock";
import { syncClock } from "./game-clock";
import { updateControls } from "./game-controls";
import { renderGoban } from "./game-render";
import { updateTitle, updatePlayerLabels, updateStatus } from "./game-ui";
import { appendToChat, updateChatPresence } from "./chat";

export type GameMessageDeps = {
  ctx: GameCtx;
  dom: GameDomElements;
  clockState: ClockState;
  channel: GameChannel;
};

export function handleGameMessage(
  raw: Record<string, unknown>,
  deps: GameMessageDeps,
): void {
  const data = raw as IncomingMessage;
  const { ctx, dom, clockState, channel } = deps;

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
      ctx.black = data.black ?? undefined;
      ctx.white = data.white ?? undefined;
      if (data.online_players) {
        ctx.onlinePlayers = new Set(data.online_players);
      }

      if (ctx.board) {
        ctx.board.updateBaseMoves(
          JSON.stringify(ctx.moves),
          !ctx.analysisMode,
        );
        if (!ctx.analysisMode && ctx.board.engine.is_at_latest()) {
          renderGoban(ctx, dom.goban, channel);
        }
        ctx.board.updateNav();
      }
      updateControls(ctx, dom);
      updateTitle(ctx, dom.title);
      updatePlayerLabels(ctx, dom.playerTop, dom.playerBottom);
      updateStatus(ctx, dom.status);
      syncClock(clockState, data.clock, ctx, dom, () => channel.timeoutFlag());
      updateChatPresence(ctx.onlinePlayers);
      break;
    }
    case "chat": {
      appendToChat({
        player_id: data.player_id,
        sender: data.sender,
        text: data.text,
        move_number: data.move_number,
        sent_at: data.sent_at,
      });
      updateChatPresence(ctx.onlinePlayers);
      break;
    }
    case "error": {
      showError(data.message);
      break;
    }
    case "undo_accepted":
    case "undo_rejected": {
      hideUndoResponseControls();
      if (data.undo_rejected !== undefined) {
        ctx.undoRejected = data.undo_rejected;
      }
      if (data.state) {
        ctx.gameState = data.state;
        ctx.currentTurn = data.current_turn_stone ?? null;
        if (data.moves) {
          ctx.moves = data.moves;
          if (ctx.board) {
            ctx.board.updateBaseMoves(
              JSON.stringify(ctx.moves),
              !ctx.analysisMode,
            );
            if (!ctx.analysisMode && ctx.board.engine.is_at_latest()) {
              renderGoban(ctx, dom.goban, channel);
            }
            ctx.board.updateNav();
          }
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
        ctx.onlinePlayers.add(data.player_id);
      } else {
        ctx.onlinePlayers.delete(data.player_id);
      }
      updatePlayerLabels(ctx, dom.playerTop, dom.playerBottom);
      updateChatPresence(ctx.onlinePlayers);
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
