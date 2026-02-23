import { GameStage, isPlayStage, type IncomingMessage } from "../goban/types";
import type { GameChannel } from "./channel";
import type { ClockState } from "./clock";
import { syncClock } from "./clock";
import type { PremoveState } from "../utils/premove";
import { updateTurnFlash, syncTerritoryCountdown } from "./ui";
import type { TerritoryCountdown } from "./ui";
import { notifyTurn, type NotificationState } from "./notifications";
import { playStoneSound, playPassSound, playJoinSound } from "./sound";
import {
  board,
  moves,
  gameStage,
  gameState,
  playerStone,
  analysisMode,
  currentTurn,
  undoResponseNeeded,
  errorMessage,
  territory,
  applyGameState,
  applyUndo,
  addChatMessage,
  setPresence,
} from "./state";

export type GameMessageDeps = {
  gobanEl: () => HTMLElement | null;
  clockState: ClockState;
  territoryCountdown: TerritoryCountdown;
  channel: GameChannel;
  premove: PremoveState;
  notificationState: NotificationState;
  onNewMove?: () => void;
};

// Track last-seen moves JSON for change detection
let prevMovesJson = "[]";

function syncBoardMoves(
  playEffects: boolean,
  gobanEl: HTMLElement | null,
  onNewMove?: () => void,
): void {
  const b = board.value;
  if (!b) {
    return;
  }
  const currentMoves = moves.value;
  const newMovesJson = JSON.stringify(currentMoves);
  if (newMovesJson !== prevMovesJson) {
    if (gameStage.value !== GameStage.Done && playEffects) {
      const lastMove = currentMoves[currentMoves.length - 1];
      if (lastMove?.kind === "play") {
        playStoneSound();
      } else if (lastMove?.kind === "pass" && gobanEl) {
        playPassSound();
        flashPassEffect(gobanEl);
      }
    }
    prevMovesJson = newMovesJson;
    b.updateBaseMoves(prevMovesJson);
    b.save();
    onNewMove?.();
  }
  if (!analysisMode.value) {
    b.render();
  }
  b.updateNav();
}

/** Reset the prevMovesJson tracker (call when board loads with initial moves). */
export function resetMovesTracker(json: string): void {
  prevMovesJson = json;
}

export function handleGameMessage(
  raw: Record<string, unknown>,
  deps: GameMessageDeps,
): void {
  const data = raw as IncomingMessage;
  const {
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
      const { prevBlack, prevWhite } = applyGameState(data);

      if (playerStone.value !== 0) {
        const opponentJoined =
          (playerStone.value === 1 && !prevWhite && data.white) ||
          (playerStone.value === -1 && !prevBlack && data.black);
        if (opponentJoined) {
          playJoinSound();
        }
      }

      syncBoardMoves(true, deps.gobanEl(), onNewMove);
      updateTurnFlash();
      notifyTurn(notificationState);
      syncClock(
        clockState,
        data.clock,
        () => channel.timeoutFlag(),
      );
      syncTerritoryCountdown(
        territoryCountdown,
        territory.value?.expires_at,
        () => channel.territoryTimeoutFlag(),
      );

      if (!isPlayStage(gameStage.value)) {
        premove.clear();
      } else if (premove.value && currentTurn.value === playerStone.value) {
        const [col, row] = premove.value;
        premove.clear();
        const gs = gameState.value;
        if (gs.board[row * gs.cols + col] === 0) {
          channel.play(col, row);
        }
        const b = board.value;
        if (b && !analysisMode.value && b.engine.is_at_latest()) {
          b.render();
        }
      }
      break;
    }
    case "chat": {
      addChatMessage({
        user_id: data.player_id,
        display_name: data.display_name,
        text: data.text,
        move_number: data.move_number,
        sent_at: data.sent_at,
      });
      break;
    }
    case "error": {
      errorMessage.value = data.message;
      break;
    }
    case "undo_accepted":
    case "undo_rejected": {
      premove.clear();
      applyUndo(data);
      if (data.state && data.moves) {
        syncBoardMoves(false, deps.gobanEl());
      }
      break;
    }
    case "undo_request_sent": {
      // No state change needed — signals auto-propagate
      break;
    }
    case "undo_response_needed": {
      undoResponseNeeded.value = true;
      break;
    }
    case "presence": {
      setPresence(data.player_id, data.online);
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
