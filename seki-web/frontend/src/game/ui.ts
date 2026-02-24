import type { ScoreData } from "../goban/types";
import type { ChatEntry } from "../components/chat";
import { formatGameDescription, formatPoints } from "../utils/format";
import {
  isMyTurn,
  gameStage,
  initialProps,
  black,
  white,
  result,
  moves,
  addChatMessage,
  updateChatEntry,
  removeChatEntry,
} from "./state";

// --- Tab title flash ("YOUR MOVE") ---

let flashInterval: ReturnType<typeof setInterval> | undefined;
let savedTitle: string | undefined;

function startFlashing() {
  if (flashInterval) {
    return;
  }
  savedTitle = document.title;
  let on = true;
  document.title = "YOUR MOVE";
  flashInterval = setInterval(() => {
    on = !on;
    document.title = on ? "YOUR MOVE" : (savedTitle ?? "");
  }, 1000);
}

function stopFlashing() {
  if (!flashInterval) {
    return;
  }
  clearInterval(flashInterval);
  flashInterval = undefined;
  if (savedTitle != null) {
    document.title = savedTitle;
    savedTitle = undefined;
  }
}

export function updateTurnFlash(): void {
  if (isMyTurn.value && document.hidden) {
    startFlashing();
  } else {
    stopFlashing();
  }
}

export function updateTitle(): void {
  const desc = formatGameDescription({
    creator_id: initialProps.value.creator_id,
    black: black.value,
    white: white.value,
    settings: initialProps.value.settings,
    stage: gameStage.value,
    result: result.value ?? undefined,
    move_count: moves.value.length > 0 ? moves.value.length : undefined,
  });
  if (!flashInterval) {
    document.title = desc;
  } else {
    savedTitle = desc;
  }
}

export function formatScoreStr(
  score: ScoreData,
  komi: number,
): { bStr: string; wStr: string } {
  const bTotal = score.black.territory + score.black.captures;
  const wTotal = score.white.territory + score.white.captures;
  const { bStr, wStr } = formatPoints(bTotal, wTotal, komi);
  return { bStr, wStr };
}

export type TerritoryCountdown = {
  deadline: number | undefined;
  interval: ReturnType<typeof setInterval> | undefined;
  flagSent: boolean;
  chatEntry: ChatEntry | undefined;
};

export function syncTerritoryCountdown(
  countdown: TerritoryCountdown,
  expiresAt: string | undefined,
  onFlag: () => void,
): void {
  if (countdown.interval) {
    clearInterval(countdown.interval);
    countdown.interval = undefined;
  }
  countdown.flagSent = false;

  if (expiresAt) {
    countdown.deadline = new Date(expiresAt).getTime();
    updateTerritoryCountdown(countdown, onFlag);
    countdown.interval = setInterval(
      () => updateTerritoryCountdown(countdown, onFlag),
      200,
    );
  } else {
    countdown.deadline = undefined;
    if (countdown.chatEntry) {
      removeChatEntry(countdown.chatEntry);
      countdown.chatEntry = undefined;
    }
  }
}

function updateTerritoryCountdown(
  countdown: TerritoryCountdown,
  onFlag: () => void,
): void {
  if (!countdown.deadline) {
    return;
  }
  const remaining = countdown.deadline - Date.now();
  if (remaining <= 0 && !countdown.flagSent) {
    countdown.flagSent = true;
    onFlag();
  }
  const secs = Math.ceil(Math.max(0, remaining) / 1000);
  const text = `Score must be accepted within ${secs}s`;

  if (!countdown.chatEntry) {
    const entry: ChatEntry = { text };
    addChatMessage(entry);
    countdown.chatEntry = entry;
  } else {
    const updated = { ...countdown.chatEntry, text };
    updateChatEntry(countdown.chatEntry, updated);
    countdown.chatEntry = updated;
  }
}
