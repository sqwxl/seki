import type { ClockData } from "./goban/types";
import type { GameCtx } from "./game-context";
import type { GameDomElements } from "./game-dom";

export type ClockState = {
  data: ClockData | undefined;
  interval: ReturnType<typeof setInterval> | undefined;
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

export function updateClocks(
  clockState: ClockState,
  ctx: GameCtx,
  dom: GameDomElements,
): void {
  if (!clockState.data) {
    for (const el of document.querySelectorAll<HTMLElement>(".player-clock")) {
      el.textContent = "";
    }
    return;
  }

  const cd = clockState.data;
  const isCorr = cd.type === "correspondence";
  const now = Date.now();
  const lastMoveAt = cd.last_move_at
    ? new Date(cd.last_move_at).getTime()
    : now;
  const elapsed = now - lastMoveAt;

  let blackMs = cd.black.remaining_ms;
  let whiteMs = cd.white.remaining_ms;

  if (cd.active_stone === 1) {
    blackMs -= elapsed;
  } else if (cd.active_stone === -1) {
    whiteMs -= elapsed;
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
): void {
  clockState.data = clockData;
  if (clockState.interval) {
    clearInterval(clockState.interval);
    clockState.interval = undefined;
  }
  if (clockState.data && clockState.data.active_stone) {
    updateClocks(clockState, ctx, dom);
    clockState.interval = setInterval(
      () => updateClocks(clockState, ctx, dom),
      100,
    );
  } else {
    updateClocks(clockState, ctx, dom);
  }
}
