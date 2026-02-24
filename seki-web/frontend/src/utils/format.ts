import type { GameSettings, ScoreData, UserData } from "../game/types";
import { GameStage, isPlayStage } from "../game/types";

// Default time-control values used when GameSettings fields are undefined.
// Keep in sync with server defaults and game-settings-form.tsx UI defaults.
export const DEFAULT_FISCHER_MAIN_SECS = 600;
export const DEFAULT_FISCHER_INCREMENT_SECS = 5;
export const DEFAULT_BYOYOMI_MAIN_SECS = 1200;
export const DEFAULT_BYOYOMI_PERIODS = 3;
export const DEFAULT_BYOYOMI_PERIOD_SECS = 30;
export const DEFAULT_CORRESPONDENCE_SECS = 259200; // 3 days

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

export function blackSymbol(): string {
  return darkQuery.matches ? "○" : "●";
}

export function whiteSymbol(): string {
  return darkQuery.matches ? "●" : "○";
}

function formatN(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

export function formatPoints(bTotal: number, wTotal: number, komi: number) {
  const bStr = formatN(bTotal);
  const wStr = komi ? `${formatN(wTotal)}+${formatN(komi)}` : formatN(wTotal);
  return { bStr, wStr };
}

export function formatResult(score: ScoreData, komi: number): string {
  const bTotal = score.black.territory + score.black.captures;
  const wTotal = score.white.territory + score.white.captures + komi;
  const diff = bTotal - wTotal;
  if (diff > 0) {
    return `B+${formatN(diff)}`;
  }
  if (diff < 0) {
    return `W+${formatN(-diff)}`;
  }
  return "Draw";
}

export function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatTimeControl(s: GameSettings): string | undefined {
  switch (s.time_control) {
    case "none":
      return undefined;
    case "fischer": {
      const main = formatTime(s.main_time_secs ?? DEFAULT_FISCHER_MAIN_SECS);
      const inc = s.increment_secs ?? DEFAULT_FISCHER_INCREMENT_SECS;
      return `${main}+${inc}s`;
    }
    case "byoyomi": {
      const main = formatTime(s.main_time_secs ?? DEFAULT_BYOYOMI_MAIN_SECS);
      const periods = s.byoyomi_periods ?? DEFAULT_BYOYOMI_PERIODS;
      const periodTime = s.byoyomi_time_secs ?? DEFAULT_BYOYOMI_PERIOD_SECS;
      return `${main} (${periods}×${periodTime}s)`;
    }
    case "correspondence": {
      const days = Math.floor(
        (s.main_time_secs ?? DEFAULT_CORRESPONDENCE_SECS) / 86400,
      );
      return `${days}d`;
    }
  }
}

/** Format SGF time metadata (TM + OT) into a readable string. */
export function formatSgfTime(
  timeLimitSecs?: number,
  overtime?: string,
): string | undefined {
  if (timeLimitSecs == null && !overtime) {
    return undefined;
  }
  const parts: string[] = [];
  if (timeLimitSecs != null) {
    parts.push(formatTime(timeLimitSecs));
  }
  if (overtime) {
    parts.push(overtime);
  }
  return parts.join(" + ");
}

/** Convert GameSettings time control to SGF TM/OT fields. */
export function settingsToSgfTime(s: GameSettings): {
  time_limit_secs?: number;
  overtime?: string;
} {
  switch (s.time_control) {
    case "none":
      return {};
    case "fischer":
      return {
        time_limit_secs: s.main_time_secs ?? DEFAULT_FISCHER_MAIN_SECS,
        overtime: `Fischer ${s.increment_secs ?? DEFAULT_FISCHER_INCREMENT_SECS}s increment`,
      };
    case "byoyomi":
      return {
        time_limit_secs: s.main_time_secs ?? DEFAULT_BYOYOMI_MAIN_SECS,
        overtime: `${s.byoyomi_periods ?? DEFAULT_BYOYOMI_PERIODS}x${s.byoyomi_time_secs ?? DEFAULT_BYOYOMI_PERIOD_SECS} byo-yomi`,
      };
    case "correspondence":
      return {
        time_limit_secs: s.main_time_secs ?? DEFAULT_CORRESPONDENCE_SECS,
        overtime: "Correspondence",
      };
  }
}

export function formatSize(cols: number, rows: number): string {
  if (cols === rows) {
    return `${cols}×${cols}`;
  }
  return `${cols}×${rows}`;
}

export type DescriptionInput = {
  creator_id: number | undefined;
  black: UserData | undefined;
  white: UserData | undefined;
  settings: GameSettings;
  stage: GameStage;
  result: string | null | undefined;
  move_count: number | undefined;
};

/** Build the "size - handicap - time control - result/move" parts array. */
export function buildDescriptionParts(g: DescriptionInput): string[] {
  const parts: string[] = [
    formatSize(g.settings.cols, g.settings.rows),
  ];

  if (g.settings.handicap >= 2) {
    parts.push(`H${g.settings.handicap}`);
  }

  const tc = formatTimeControl(g.settings);
  if (tc) {
    parts.push(tc);
  }

  if (g.result) {
    parts.push(g.result);
  } else if (
    (isPlayStage(g.stage) || g.stage === GameStage.TerritoryReview) &&
    g.move_count != null
  ) {
    parts.push(`Move ${g.move_count}`);
  }

  return parts;
}

export function formatGameDescription(g: DescriptionInput): string {
  const b = g.black?.display_name ?? "?";
  const w = g.white?.display_name ?? "?";

  const creatorIsWhite = g.creator_id != null && g.white?.id === g.creator_id;
  const first = creatorIsWhite
    ? `${w} ${whiteSymbol()}`
    : `${b} ${blackSymbol()}`;
  const second = creatorIsWhite
    ? `${b} ${blackSymbol()}`
    : `${w} ${whiteSymbol()}`;

  return [`${first} vs ${second}`, ...buildDescriptionParts(g)].join(" - ");
}

export function parseDatasetJson<T>(
  root: HTMLElement,
  key: string,
): T | undefined {
  const json = root.dataset[key];
  if (!json) {
    return undefined;
  }
  try {
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
}
