import { GameStage, isPlayStage, type IncomingMessage } from "./goban/types";
import type { GameCtx } from "./game-context";
import type { GameChannel } from "./game-channel";
import type { ClockState } from "./game-clock";
import { syncClock } from "./game-clock";
import type { PremoveState } from "./premove";
import { updateTurnFlash, syncTerritoryCountdown } from "./game-ui";
import type { TerritoryCountdown } from "./game-ui";
import { notifyTurn, type NotificationState } from "./game-notifications";
import { playStoneSound, playPassSound, playJoinSound } from "./game-sound";

export type GameMessageDeps = {
  ctx: GameCtx;
  gobanEl: () => HTMLElement | null;
  clockState: ClockState;
  territoryCountdown: TerritoryCountdown;
  channel: GameChannel;
  premove: PremoveState;
  notificationState: NotificationState;
  rerender: () => void;
  onNewMove?: () => void;
};

function syncBoardMoves(
  ctx: GameCtx,
  playEffects: boolean,
  gobanEl: HTMLElement | null,
  onNewMove?: () => void,
): void {
  if (!ctx.board) {
    return;
  }
  const newMovesJson = JSON.stringify(ctx.moves);
  if (newMovesJson !== ctx.movesJson) {
    if (ctx.gameStage !== GameStage.Done && playEffects) {
      const lastMove = ctx.moves[ctx.moves.length - 1];
      if (lastMove?.kind === "play") {
        playStoneSound();
      } else if (lastMove?.kind === "pass" && gobanEl) {
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
  const {
    ctx,
    clockState,
    territoryCountdown,
    channel,
    premove,
    notificationState,
    onNewMove,
  } = deps;

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
      if (ctx.territory) {
        if (ctx.territory.black_approved && !ctx._prevBlackApproved) {
          ctx.chatMessages.push({ text: "Black accepted the score" });
        }
        if (ctx.territory.white_approved && !ctx._prevWhiteApproved) {
          ctx.chatMessages.push({ text: "White accepted the score" });
        }
        ctx._prevBlackApproved = ctx.territory.black_approved;
        ctx._prevWhiteApproved = ctx.territory.white_approved;
      }
      ctx.settledTerritory = data.settled_territory;
      const prevBlack = ctx.black;
      const prevWhite = ctx.white;
      ctx.black = data.black ?? undefined;
      ctx.white = data.white ?? undefined;
      if (ctx.playerStone !== 0) {
        const opponentJoined =
          (ctx.playerStone === 1 && !prevWhite && ctx.white) ||
          (ctx.playerStone === -1 && !prevBlack && ctx.black);
        if (opponentJoined) {
          playJoinSound();
        }
      }
      if (data.online_users) {
        ctx.onlineUsers = new Set(data.online_users);
      }

      syncBoardMoves(ctx, true, deps.gobanEl(), onNewMove);
      updateTurnFlash(ctx);
      notifyTurn(ctx, notificationState);
      syncClock(
        clockState,
        data.clock,
        ctx,
        () => channel.timeoutFlag(),
        deps.rerender,
      );
      syncTerritoryCountdown(
        territoryCountdown,
        ctx.territory?.expires_at,
        ctx,
        deps.rerender,
        () => channel.territoryTimeoutFlag(),
      );
      deps.rerender();

      if (!isPlayStage(ctx.gameStage)) {
        premove.clear();
      } else if (premove.value && ctx.currentTurn === ctx.playerStone) {
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
      ctx.chatMessages.push({
        user_id: data.player_id,
        display_name: data.display_name,
        text: data.text,
        move_number: data.move_number,
        sent_at: data.sent_at,
      });
      deps.rerender();
      break;
    }
    case "error": {
      ctx.errorMessage = data.message;
      deps.rerender();
      break;
    }
    case "undo_accepted":
    case "undo_rejected": {
      ctx.undoResponseNeeded = false;
      premove.clear();
      if (data.undo_rejected !== undefined) {
        ctx.undoRejected = data.undo_rejected;
      }
      if (data.state) {
        ctx.gameState = data.state;
        ctx.currentTurn = data.current_turn_stone ?? null;
        if (data.moves) {
          ctx.moves = data.moves;
          syncBoardMoves(ctx, false, deps.gobanEl());
        }
        deps.rerender();
      }
      break;
    }
    case "undo_request_sent": {
      deps.rerender();
      break;
    }
    case "undo_response_needed": {
      ctx.undoResponseNeeded = true;
      deps.rerender();
      break;
    }
    case "presence": {
      if (data.online) {
        ctx.onlineUsers.add(data.player_id);
      } else {
        ctx.onlineUsers.delete(data.player_id);
      }
      deps.rerender();
      break;
    }
    default: {
      console.warn("Unknown game message kind:", data);
      break;
    }
  }
}

export function flashPassEffect(goban: HTMLElement): void {
  goban.classList.remove("goban-pass-flash");
  // Force reflow so re-adding the class restarts the animation
  void goban.offsetWidth;
  goban.classList.add("goban-pass-flash");
  goban.addEventListener(
    "animationend",
    () => {
      goban.classList.remove("goban-pass-flash");
    },
    { once: true },
  );
}
