import type { GameSettings, UserData } from "./goban/types";

export type { GameSettings, UserData };

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

export function blackSymbol(): string {
  return darkQuery.matches ? "○" : "●";
}

export function whiteSymbol(): string {
  return darkQuery.matches ? "●" : "○";
}

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatTimeControl(s: GameSettings): string | undefined {
  switch (s.time_control) {
    case "none":
      return undefined;
    case "fischer": {
      const main = formatTime(s.main_time_secs ?? 600);
      const inc = s.increment_secs ?? 5;
      return `${main}+${inc}s`;
    }
    case "byoyomi": {
      const main = formatTime(s.main_time_secs ?? 1200);
      const periods = s.byoyomi_periods ?? 3;
      const periodTime = s.byoyomi_time_secs ?? 30;
      return `${main} (${periods}×${periodTime}s)`;
    }
    case "correspondence": {
      const days = Math.floor((s.main_time_secs ?? 259200) / 86400);
      return `${days}d`;
    }
  }
}

function formatSize(cols: number, rows: number): string {
  if (cols === rows) {
    return `${cols}×${cols}`;
  }
  return `${cols}×${rows}`;
}

function isPlayStage(stage: string): boolean {
  return stage === "black_to_play" || stage === "white_to_play";
}

type DescriptionInput = {
  black: UserData | undefined;
  white: UserData | undefined;
  settings: GameSettings;
  stage: string;
  result: string | null | undefined;
  move_count: number | undefined;
};

export function formatGameDescription(g: DescriptionInput): string {
  const b = g.black?.display_name ?? "?";
  const w = g.white?.display_name ?? "?";

  const parts: string[] = [
    `${blackSymbol()} ${b} vs ${whiteSymbol()} ${w}`,
    formatSize(g.settings.cols, g.settings.rows),
  ];

  const tc = formatTimeControl(g.settings);
  if (tc) {
    parts.push(tc);
  }

  if (g.result) {
    parts.push(g.result);
  } else if (
    (isPlayStage(g.stage) || g.stage === "territory_review") &&
    g.move_count != null
  ) {
    parts.push(`Move ${g.move_count}`);
  }

  return parts.join(" - ");
}
