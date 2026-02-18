import type { ClockData, GameSettings } from "./goban/types";
import type { GameCtx } from "./game-context";
import type { GameDomElements } from "./game-dom";

export type ClockState = {
  data: ClockData | undefined;
  syncedAt: number; // performance.now() when data was received
  interval: ReturnType<typeof setInterval> | undefined;
  timeoutFlagSent: boolean;
};

export function formatClock(ms: number, isCorrespondence: boolean): string {
  if (isCorrespondence) {
    const totalSecs = Math.max(0, Math.floor(ms / 1000));
    const days = Math.floor(totalSecs / 86400);
    const hours = Math.floor((totalSecs % 86400) / 3600);
    if (days > 0) {
      return `${days}d ${hours}h`;
    }
    const mins = Math.floor((totalSecs % 3600) / 60);
    return `${hours}h ${mins}m`;
  }
  const totalSecs = Math.max(0, Math.floor(ms / 1000));
  if (totalSecs < 10) {
    const tenths = Math.max(0, Math.floor(ms / 100)) / 10;
    return tenths.toFixed(1);
  }
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function totalRemainingMs(
  cd: ClockData,
  stone: 1 | -1,
  elapsed: number,
  settings: GameSettings,
): number {
  const side = stone === 1 ? cd.black : cd.white;
  let remaining = side.remaining_ms;
  if (cd.active_stone === stone) {
    remaining -= elapsed;
  }
  if (cd.type === "byoyomi" && side.periods > 0 && remaining <= 0) {
    const periodMs = (settings.byoyomi_time_secs ?? 30) * 1000;
    return side.periods * periodMs + remaining;
  }
  return remaining;
}

export function updateClocks(
  clockState: ClockState,
  ctx: GameCtx,
  dom: GameDomElements,
  onFlag: (() => void) | undefined,
  settings: GameSettings | undefined,
): void {
  if (!clockState.data) {
    for (const el of document.querySelectorAll<HTMLElement>(".player-clock")) {
      el.textContent = "";
    }
    return;
  }

  const cd = clockState.data;
  const isCorr = cd.type === "correspondence";
  const elapsed = performance.now() - clockState.syncedAt;

  let blackMs = cd.black.remaining_ms;
  let whiteMs = cd.white.remaining_ms;

  if (cd.active_stone === 1) {
    blackMs -= elapsed;
  } else if (cd.active_stone === -1) {
    whiteMs -= elapsed;
  }

  // Check for timeout on the active user
  if (onFlag && cd.active_stone && !clockState.timeoutFlagSent && settings) {
    const activeStone = cd.active_stone as 1 | -1;
    const total = totalRemainingMs(cd, activeStone, elapsed, settings);
    if (total <= 0) {
      clockState.timeoutFlagSent = true;
      onFlag();
    }
  }

  const blackText = formatClock(blackMs, isCorr);
  const whiteText = formatClock(whiteMs, isCorr);

  const blackPeriods =
    cd.type === "byoyomi" && cd.black.periods > 0
      ? ` (${cd.black.periods})`
      : "";
  const whitePeriods =
    cd.type === "byoyomi" && cd.white.periods > 0
      ? ` (${cd.white.periods})`
      : "";

  if (dom.playerTop && dom.playerBottom) {
    const topClockEl = dom.playerTop.querySelector<HTMLElement>(".player-clock");
    const bottomClockEl =
      dom.playerBottom.querySelector<HTMLElement>(".player-clock");

    if (ctx.playerStone === -1) {
      if (topClockEl) {
        topClockEl.textContent = blackText + blackPeriods;
        topClockEl.classList.toggle("low-time", blackMs < 10000);
      }
      if (bottomClockEl) {
        bottomClockEl.textContent = whiteText + whitePeriods;
        bottomClockEl.classList.toggle("low-time", whiteMs < 10000);
      }
    } else {
      if (topClockEl) {
        topClockEl.textContent = whiteText + whitePeriods;
        topClockEl.classList.toggle("low-time", whiteMs < 10000);
      }
      if (bottomClockEl) {
        bottomClockEl.textContent = blackText + blackPeriods;
        bottomClockEl.classList.toggle("low-time", blackMs < 10000);
      }
    }
  }
}

export function syncClock(
  clockState: ClockState,
  clockData: ClockData | undefined,
  ctx: GameCtx,
  dom: GameDomElements,
  onFlag: (() => void) | undefined,
): void {
  clockState.data = clockData;
  clockState.syncedAt = performance.now();
  clockState.timeoutFlagSent = false;
  if (clockState.interval) {
    clearInterval(clockState.interval);
    clockState.interval = undefined;
  }
  const settings = ctx.initialProps.settings;
  if (clockState.data && clockState.data.active_stone) {
    updateClocks(clockState, ctx, dom, onFlag, settings);
    clockState.interval = setInterval(
      () => updateClocks(clockState, ctx, dom, onFlag, settings),
      100,
    );
  } else {
    updateClocks(clockState, ctx, dom, onFlag, settings);
  }
}
