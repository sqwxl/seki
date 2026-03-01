import { GameStage, isPlayStage, type IncomingMessage } from "./types";
import type { GameChannel } from "./channel";
import type { ClockState } from "./clock";
import { syncClock } from "./clock";
import type { PremoveState } from "../utils/premove";
import { updateTurnFlash, syncTerritoryCountdown } from "./ui";
import type { TerritoryCountdown } from "./ui";
import { notifyTurn, type NotificationState } from "./notifications";
import { markRead } from "./unread";
import { playStoneSound, playPassSound } from "./sound";
import {
  board,
  moves,
  gameStage,
  gameState,
  gameId,
  playerStone,
  analysisMode,
  currentTurn,
  undoResponseNeeded,
  territory,
  opponentDisconnected,
  black,
  white,
  presenterId,
  controlRequest,
  applyGameStateMessage,
  applyUndo,
  addChatMessage,
  setPresence,
  isPresenter,
  applyPresentationStarted,
  clearPresentation,
} from "./state";

export type GameMessageDeps = {
  gobanEl: () => HTMLElement | null;
  clockState: ClockState;
  territoryCountdown: TerritoryCountdown;
  channel: GameChannel;
  premove: PremoveState;
  notificationState: NotificationState;
  onNewMove?: () => void;
  onPresentationStarted?: (snapshot: string) => void;
  onPresentationEnded?: (wasPresenter: boolean) => void;
  onPresentationUpdate?: (snapshot: string) => void;
  onControlChanged?: (newPresenterId: number) => void;
};

// Track last-seen moves JSON for change detection
let prevMovesJson = "[]";

// Suppress sound/flash on the first "state" message (initial load)
let initialStateReceived = false;

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
    if (gameStage.value !== GameStage.Completed && playEffects) {
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
}

/** Reset the prevMovesJson tracker (call when board loads with initial moves). */
export function resetMovesTracker(json: string): void {
  prevMovesJson = json;
  initialStateReceived = false;
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
      const isLiveUpdate = initialStateReceived;
      initialStateReceived = true;

      const prevStage = gameStage.value;
      applyGameStateMessage(data);

      if (isLiveUpdate) {
        const gameJustStarted =
          (prevStage === GameStage.Unstarted ||
            prevStage === GameStage.Challenge) &&
          isPlayStage(data.stage);
        if (gameJustStarted) {
          playPassSound();
        }
      }

      syncBoardMoves(isLiveUpdate, deps.gobanEl(), onNewMove);
      markRead(gameId.value);
      if (isLiveUpdate) {
        updateTurnFlash();
        notifyTurn(notificationState);
      }
      syncClock(clockState, data.clock, () => channel.timeoutFlag());
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
      console.warn("Game error:", data.message);
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
      setPresence(data.player_id, data.online, data.user);
      break;
    }
    case "player_disconnected": {
      if (isOpponent(data.user_id)) {
        opponentDisconnected.value = { since: new Date(data.timestamp) };
      }
      break;
    }
    case "player_reconnected": {
      if (isOpponent(data.user_id)) {
        opponentDisconnected.value = undefined;
      }
      break;
    }
    case "presentation_started": {
      applyPresentationStarted(data);
      deps.onPresentationStarted?.(data.snapshot);
      break;
    }
    case "presentation_ended": {
      const wasPresenter = isPresenter.value;
      clearPresentation();
      deps.onPresentationEnded?.(wasPresenter);
      break;
    }
    case "presentation_update": {
      deps.onPresentationUpdate?.(data.snapshot);
      break;
    }
    case "control_changed": {
      presenterId.value = data.presenter_id;
      controlRequest.value = undefined;
      deps.onControlChanged?.(data.presenter_id);
      break;
    }
    case "control_requested": {
      controlRequest.value = {
        userId: data.user_id,
        displayName: data.display_name,
      };
      break;
    }
    case "control_request_cancelled": {
      controlRequest.value = undefined;
      break;
    }
    case "ws_reconnected": {
      // Clear stale local state before the server sends fresh state on rejoin.
      // Without this, presentation signals from a previous session persist
      // (e.g. "You are presenting" after the presentation ended while offline).
      clearPresentation();
      initialStateReceived = false;
      break;
    }
    default: {
      console.warn("Unknown game message kind:", data);
      break;
    }
  }
}

function isOpponent(userId: number): boolean {
  const myStone = playerStone.value;
  if (myStone === 1) {
    return white.value?.id === userId;
  }
  if (myStone === -1) {
    return black.value?.id === userId;
  }
  return false;
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
