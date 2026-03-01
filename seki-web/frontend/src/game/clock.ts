import { signal } from "@preact/signals";
import type { ClockData, GameSettings } from "./types";
import { DEFAULT_BYOYOMI_PERIOD_SECS } from "../utils/format";
import { initialProps } from "./state";

export type ClockState = {
  data: ClockData | undefined;
  syncedAt: number; // performance.now() when data was received
  interval: ReturnType<typeof setInterval> | undefined;
  timeoutFlagSent: boolean;
};

export type ClockDisplay = {
  blackText: string;
  whiteText: string;
  blackLow: boolean;
  whiteLow: boolean;
};

export const clockDisplay = signal<ClockDisplay>({
  blackText: "",
  whiteText: "",
  blackLow: false,
  whiteLow: false,
});

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
    const periodMs =
      (settings.byoyomi_time_secs ?? DEFAULT_BYOYOMI_PERIOD_SECS) * 1000;
    return side.periods * periodMs + remaining;
  }
  return remaining;
}

export function computeClockDisplay(clockState: ClockState): ClockDisplay {
  if (!clockState.data) {
    return { blackText: "", whiteText: "", blackLow: false, whiteLow: false };
  }

  const cd = clockState.data;
  const settings = initialProps.value.settings;
  const isCorr = cd.type === "correspondence";
  const elapsed = performance.now() - clockState.syncedAt;

  let blackMs = cd.black.remaining_ms;
  let whiteMs = cd.white.remaining_ms;

  if (cd.active_stone === 1) {
    blackMs -= elapsed;
  } else if (cd.active_stone === -1) {
    whiteMs -= elapsed;
  }

  // For byoyomi, simulate period transitions so the display doesn't
  // show 0/negative while periods remain (server will sync the real state).
  let blackPeriodCount = cd.black.periods;
  let whitePeriodCount = cd.white.periods;

  if (cd.type === "byoyomi") {
    const periodMs =
      (settings.byoyomi_time_secs ?? DEFAULT_BYOYOMI_PERIOD_SECS) * 1000;
    while (blackMs <= 0 && blackPeriodCount > 0) {
      blackMs += periodMs;
      blackPeriodCount--;
    }
    while (whiteMs <= 0 && whitePeriodCount > 0) {
      whiteMs += periodMs;
      whitePeriodCount--;
    }
  }

  const blackText = formatClock(blackMs, isCorr);
  const whiteText = formatClock(whiteMs, isCorr);

  const blackPeriods =
    cd.type === "byoyomi" && blackPeriodCount > 0
      ? ` (${blackPeriodCount})`
      : "";
  const whitePeriods =
    cd.type === "byoyomi" && whitePeriodCount > 0
      ? ` (${whitePeriodCount})`
      : "";

  // Use total remaining (including all periods) for low-time detection
  const blackTotal = totalRemainingMs(cd, 1, elapsed, settings);
  const whiteTotal = totalRemainingMs(cd, -1, elapsed, settings);

  return {
    blackText: blackText + blackPeriods,
    whiteText: whiteText + whitePeriods,
    blackLow: blackTotal < 10000,
    whiteLow: whiteTotal < 10000,
  };
}

export function checkClockTimeout(
  clockState: ClockState,
  settings: GameSettings,
  onFlag: () => void,
): void {
  if (
    !clockState.data ||
    !clockState.data.active_stone ||
    clockState.timeoutFlagSent
  ) {
    return;
  }
  const cd = clockState.data;
  const elapsed = performance.now() - clockState.syncedAt;
  const activeStone = cd.active_stone as 1 | -1;
  const total = totalRemainingMs(cd, activeStone, elapsed, settings);
  if (total <= 0) {
    clockState.timeoutFlagSent = true;
    onFlag();
  }
}

function updateClockSignal(clockState: ClockState): void {
  clockDisplay.value = computeClockDisplay(clockState);
}

export function syncClock(
  clockState: ClockState,
  clockData: ClockData | undefined,
  onFlag?: () => void,
): void {
  clockState.data = clockData;
  clockState.syncedAt = performance.now();
  clockState.timeoutFlagSent = false;
  if (clockState.interval) {
    clearInterval(clockState.interval);
    clockState.interval = undefined;
  }
  const settings = initialProps.value.settings;
  if (clockState.data && clockState.data.active_stone) {
    if (onFlag) {
      checkClockTimeout(clockState, settings, onFlag);
    }
    updateClockSignal(clockState);
    clockState.interval = setInterval(() => {
      if (onFlag) {
        checkClockTimeout(clockState, settings, onFlag);
      }
      updateClockSignal(clockState);
    }, 100);
  } else {
    updateClockSignal(clockState);
  }
}
