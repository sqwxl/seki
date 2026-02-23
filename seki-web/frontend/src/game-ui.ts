import { isPlayStage } from "./goban/types";
import type { ScoreData } from "./goban/types";
import type { GameCtx } from "./game-context";
import type { ChatEntry } from "./chat";
import { formatGameDescription, formatPoints } from "./format";

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

export function updateTurnFlash(ctx: GameCtx): void {
  const isMyTurn =
    ctx.playerStone !== 0 &&
    ctx.currentTurn === ctx.playerStone &&
    isPlayStage(ctx.gameStage);
  if (isMyTurn && document.hidden) {
    startFlashing();
  } else {
    stopFlashing();
  }
}

export function updateTitle(ctx: GameCtx): void {
  const desc = formatGameDescription({
    creator_id: ctx.initialProps.creator_id,
    black: ctx.black,
    white: ctx.white,
    settings: ctx.initialProps.settings,
    stage: ctx.gameStage,
    result: ctx.result ?? undefined,
    move_count: ctx.moves.length > 0 ? ctx.moves.length : undefined,
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
  ctx: GameCtx,
  rerender: () => void,
  onFlag: () => void,
): void {
  if (countdown.interval) {
    clearInterval(countdown.interval);
    countdown.interval = undefined;
  }
  countdown.flagSent = false;

  if (expiresAt) {
    countdown.deadline = new Date(expiresAt).getTime();
    updateTerritoryCountdown(countdown, ctx, rerender, onFlag);
    countdown.interval = setInterval(
      () => updateTerritoryCountdown(countdown, ctx, rerender, onFlag),
      200,
    );
  } else {
    countdown.deadline = undefined;
    if (countdown.chatEntry) {
      const idx = ctx.chatMessages.indexOf(countdown.chatEntry);
      if (idx >= 0) {
        ctx.chatMessages.splice(idx, 1);
      }
      countdown.chatEntry = undefined;
    }
    rerender();
  }
}

function updateTerritoryCountdown(
  countdown: TerritoryCountdown,
  ctx: GameCtx,
  rerender: () => void,
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
    ctx.chatMessages.push(entry);
    countdown.chatEntry = entry;
  } else {
    countdown.chatEntry.text = text;
  }
  rerender();
}
