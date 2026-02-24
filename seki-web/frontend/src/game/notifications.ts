import { isPlayStage } from "../goban/types";
import {
  playerStone,
  currentTurn,
  gameStage,
  gameId,
  moves,
  black,
  white,
} from "./state";
import { setIcon, bellSvg, bellDisabledSvg } from "../components/icons";
import { storage, NOTIFICATIONS } from "../utils/storage";
const TOGGLE_ID = "notification-toggle";

export type NotificationState = {
  lastNotifiedMoveCount: number;
};

export function createNotificationState(): NotificationState {
  return { lastNotifiedMoveCount: -1 };
}

function isSupported(): boolean {
  return "Notification" in window;
}

function isEnabled(): boolean {
  return (
    isSupported() &&
    storage.get(NOTIFICATIONS) === "on" &&
    Notification.permission === "granted"
  );
}

function updateToggleIcon(): void {
  const btn = document.getElementById(TOGGLE_ID);
  if (!btn) {
    return;
  }

  const denied = isSupported() && Notification.permission === "denied";
  const on = isEnabled();

  setIcon(TOGGLE_ID, on ? bellSvg : bellDisabledSvg);
  btn.title = denied
    ? "Notifications blocked by browser"
    : on
      ? "Disable turn notifications"
      : "Enable turn notifications";

  if (denied) {
    btn.setAttribute("disabled", "");
  } else {
    btn.removeAttribute("disabled");
  }
}

export function initNotificationToggle(): void {
  const btn = document.getElementById(TOGGLE_ID);
  if (!btn) {
    return;
  }

  if (!isSupported()) {
    btn.style.display = "none";
    return;
  }

  btn.addEventListener("click", async () => {
    if (Notification.permission === "denied") {
      return;
    }
    if (Notification.permission === "default") {
      const result = await Notification.requestPermission();
      if (result !== "granted") {
        updateToggleIcon();
        return;
      }
    }
    const next = storage.get(NOTIFICATIONS) === "on" ? "off" : "on";
    storage.set(NOTIFICATIONS, next);
    updateToggleIcon();
  });

  updateToggleIcon();
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

export function notifyGameStarted(): void {
  if (!isEnabled() || !document.hidden) {
    return;
  }

  sendNotification(
    "Game started",
    `Your game against ${getOpponentName()} has begun!`,
    `seki-start-${gameId.value}`,
  );
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
