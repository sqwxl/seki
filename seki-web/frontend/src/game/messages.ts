import { GameStage, isPlayStage, type IncomingMessage } from "./types";
import type { GameChannel } from "./channel";
import type { ClockState } from "./clock";
import { syncClock } from "./clock";
import type { MoveConfirmState } from "../utils/move-confirm";
import { updateTurnFlash, syncTerritoryCountdown } from "./ui";
import type { TerritoryCountdown } from "./ui";
import { notifyTurn, type NotificationState } from "./notifications";
import { markRead } from "./unread";
import { localDisconnected } from "../ws";
import { playStoneSound, playPassSound } from "./sound";
import {
  board,
  moves,
  gameStage,
  gameId,
  currentTurn,
  playerStone,
  analysisMode,
  undoRequest,
  territory,
  settledTerritory,
  opponentDisconnected,
  black,
  white,
  result,
  presenterId,
  controlRequest,
  clearPendingAction,
  pendingAction,
  setGameFlashMessage,
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
  pendingMove: MoveConfirmState;
  notificationState: NotificationState;
  onNewMove?: () => void;
  onPresentationStarted?: (snapshot: string) => void;
  onPresentationEnded?: (wasPresenter: boolean) => void;
  onPresentationUpdate?: (snapshot: string) => void;
  onControlChanged?: (newPresenterId: number) => void;
};

// Track last-seen move count for cheap change detection
let prevMoveCount = 0;

function reconcilePendingActionFromState(): void {
  switch (pendingAction.value) {
    case "pass":
      if (currentTurnChangedAwayFromPlayer() || !isPlayStage(gameStage.value)) {
        clearPendingAction("pass");
      }
      break;
    case "resign":
    case "claim-victory":
      if (result.value || gameStage.value === GameStage.Completed) {
        clearPendingAction();
      }
      break;
    case "abort":
    case "decline-challenge":
      if (
        result.value ||
        gameStage.value === GameStage.Aborted ||
        gameStage.value === GameStage.Declined
      ) {
        clearPendingAction();
      }
      break;
    case "accept-challenge":
      if (gameStage.value !== GameStage.Challenge) {
        clearPendingAction();
      }
      break;
    case "join-game":
      if (playerStone.value !== 0 || gameStage.value !== GameStage.Challenge) {
        clearPendingAction("join-game");
      }
      break;
    case "accept-territory":
      if (
        gameStage.value !== GameStage.TerritoryReview ||
        (playerStone.value === 1 && territory.value?.black_approved) ||
        (playerStone.value === -1 && territory.value?.white_approved)
      ) {
        clearPendingAction("accept-territory");
      }
      break;
  }
}

function currentTurnChangedAwayFromPlayer(): boolean {
  return playerStone.value !== 0 && currentTurn.value !== playerStone.value;
}

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
  if (currentMoves.length !== prevMoveCount) {
    if (gameStage.value !== GameStage.Completed && playEffects) {
      const lastMove = currentMoves[currentMoves.length - 1];
      if (lastMove?.kind === "play") {
        playStoneSound();
      } else if (lastMove?.kind === "pass" && gobanEl) {
        playPassSound();
        flashPassEffect(gobanEl);
      }
    }
    prevMoveCount = currentMoves.length;
    b.updateBaseMoves(JSON.stringify(currentMoves));
    b.save();
    onNewMove?.();
  }
  if (!analysisMode.value) {
    b.render();
  }
}

/** Reset the move count tracker (call when board loads with initial moves). */
export function resetMovesTracker(count: number): void {
  prevMoveCount = count;
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
    pendingMove,
    notificationState,
    onNewMove,
  } = deps;

  console.debug("Game message:", data);

  switch (data.kind) {
    case "state_sync":
    case "state": {
      localDisconnected.value = false;
      const isLiveUpdate = data.kind === "state";

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
      // Mark the base tip as settled when territory is agreed
      if (settledTerritory.value && board.value) {
        board.value.markSettled(settledTerritory.value.dead_stones);
        board.value.render();
      }
      markRead(gameId.value);
      if (isLiveUpdate) {
        updateTurnFlash();
        notifyTurn(notificationState);
      } else {
        // Seed notification state from sync so visibilitychange doesn't
        // fire spuriously for moves that were already present on load.
        notificationState.lastNotifiedMoveCount = moves.value.length;
      }
      syncClock(clockState, data.clock, () => channel.timeoutFlag());
      syncTerritoryCountdown(
        territoryCountdown,
        territory.value?.expires_at,
        () => channel.territoryTimeoutFlag(),
      );

      if (!isPlayStage(gameStage.value)) {
        pendingMove.clear();
      }
      reconcilePendingActionFromState();
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
      clearPendingAction();
      setGameFlashMessage(data.message);
      break;
    }
    case "undo_accepted":
    case "undo_rejected": {
      pendingMove.clear();
      applyUndo(data);
      if (data.state && data.moves) {
        syncBoardMoves(false, deps.gobanEl());
      }
      syncClock(clockState, data.clock, () => channel.timeoutFlag());
      clearPendingAction("respond-undo-accept");
      clearPendingAction("respond-undo-reject");
      clearPendingAction("request-undo");
      break;
    }
    case "undo_request_sent": {
      undoRequest.value = "sent";
      clearPendingAction("request-undo");
      break;
    }
    case "undo_response_needed": {
      undoRequest.value = "received";
      break;
    }
    case "player_disconnected": {
      setPresence(data.user_id, false);
      if (isOpponent(data.user_id)) {
        opponentDisconnected.value = {
          since: new Date(data.timestamp),
          gracePeriodMs: data.grace_period_ms,
          gone: false,
        };
      }
      break;
    }
    case "player_gone": {
      if (isOpponent(data.user_id)) {
        const current = opponentDisconnected.value;
        if (current) {
          opponentDisconnected.value = { ...current, gone: true };
        }
      }
      break;
    }
    case "player_reconnected": {
      // Look up user data from black/white signals
      const userData =
        black.value?.id === data.user_id
          ? black.value
          : white.value?.id === data.user_id
            ? white.value
            : undefined;
      if (userData) {
        setPresence(data.user_id, true, userData);
      }
      if (isOpponent(data.user_id)) {
        opponentDisconnected.value = undefined;
      }
      break;
    }
    case "presentation_started": {
      applyPresentationStarted(data);
      clearPendingAction("start-presentation");
      deps.onPresentationStarted?.(data.snapshot);
      break;
    }
    case "presentation_ended": {
      const wasPresenter = isPresenter.value;
      clearPresentation();
      clearPendingAction("end-presentation");
      clearPendingAction("give-control");
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
      clearPendingAction("take-control");
      clearPendingAction("request-control");
      clearPendingAction("cancel-control-request");
      clearPendingAction("reject-control-request");
      clearPendingAction("give-control");
      deps.onControlChanged?.(data.presenter_id);
      break;
    }
    case "control_requested": {
      controlRequest.value = {
        userId: data.user_id,
        displayName: data.display_name,
      };
      clearPendingAction("request-control");
      break;
    }
    case "control_request_cancelled": {
      controlRequest.value = undefined;
      clearPendingAction("cancel-control-request");
      clearPendingAction("reject-control-request");
      break;
    }
    case "ws_reconnected": {
      localDisconnected.value = false;
      // Clear stale local state before the server sends fresh state on rejoin.
      // Without this, presentation signals from a previous session persist
      // (e.g. "You are presenting" after the presentation ended while offline).
      clearPresentation();
      clearPendingAction();
      break;
    }
    case "ws_disconnected": {
      localDisconnected.value = true;
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
