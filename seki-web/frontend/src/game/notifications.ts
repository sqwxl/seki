import { isPlayStage } from "./types";
import {
  playerStone,
  currentTurn,
  gameStage,
  gameId,
  moves,
  black,
  white,
} from "./state";
import { storage, NOTIFICATIONS } from "../utils/storage";

export type NotificationState = {
  lastNotifiedMoveCount: number;
};

export function createNotificationState(): NotificationState {
  return { lastNotifiedMoveCount: -1 };
}

function isEnabled(): boolean {
  return (
    "Notification" in window &&
    storage.get(NOTIFICATIONS) === "on" &&
    Notification.permission === "granted"
  );
}

function getOpponentName(): string {
  return playerStone.value === 1
    ? (white.value?.display_name ?? "White")
    : (black.value?.display_name ?? "Black");
}

function sendNotification(title: string, body: string, tag: string): void {
  const n = new Notification(title, { body, tag });
  n.onclick = () => {
    window.focus();
    n.close();
  };
}

export function notifyTurn(state: NotificationState): void {
  if (!isEnabled() || !document.hidden) {
    return;
  }
  if (playerStone.value === 0) {
    return;
  }
  if (currentTurn.value !== playerStone.value) {
    return;
  }
  if (!isPlayStage(gameStage.value)) {
    return;
  }

  const moveCount = moves.value.length;
  if (moveCount <= state.lastNotifiedMoveCount) {
    return;
  }
  state.lastNotifiedMoveCount = moveCount;

  sendNotification(
    "Your turn",
    `${getOpponentName()} has played. It's your move!`,
    `seki-turn-${gameId.value}`,
  );
}
