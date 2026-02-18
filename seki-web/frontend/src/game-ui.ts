import { GameStage } from "./goban/types";
import type { ScoreData } from "./goban/types";
import type { GameCtx } from "./game-context";
import { formatGameDescription, blackSymbol, whiteSymbol } from "./format";
const CHECKMARK = "✓";

export function updateTitle(ctx: GameCtx, titleEl: HTMLElement | null): void {
  if (titleEl) {
    titleEl.textContent = formatGameDescription({
      black: ctx.black,
      white: ctx.white,
      settings: ctx.initialProps.settings,
      stage: ctx.gameStage,
      result: ctx.result,
      move_count: ctx.moves.length > 0 ? ctx.moves.length : undefined,
    });
  }
}

function setLabel(
  el: HTMLElement,
  name: string,
  points: string,
  isOnline: boolean,
): void {
  const nameEl = el.querySelector(".player-name");
  const pointsEl = el.querySelector(".player-captures");
  const dotEl = el.querySelector(".presence-dot");
  if (nameEl) {
    nameEl.textContent = name;
  }
  if (pointsEl) {
    pointsEl.textContent = points;
  }
  if (dotEl) {
    dotEl.classList.toggle("online", isOnline);
  }
}

function formatN(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

function formatScoreStr(score: ScoreData, komi: number): { bStr: string; wStr: string } {
  const bTotal = score.black.territory + score.black.captures;
  const wTotal = score.white.territory + score.white.captures;
  const bStr = `${formatN(bTotal)} ${blackSymbol()}`;
  const wStr = komi
    ? `${formatN(wTotal)}+${formatN(komi)} ${whiteSymbol()}`
    : `${formatN(wTotal)} ${whiteSymbol()}`;
  return { bStr, wStr };
}

export function updatePlayerLabels(
  ctx: GameCtx,
  topEl: HTMLElement | null,
  bottomEl: HTMLElement | null,
): void {
  if (!topEl || !bottomEl) {
    return;
  }

  const { black, white } = ctx;
  const bName = `${blackSymbol()} ${black ? black.display_name : "…"}`;
  const wName = `${whiteSymbol()} ${white ? white.display_name : "…"}`;
  const bOnline = black ? ctx.onlinePlayers.has(black.id) : false;
  const wOnline = white ? ctx.onlinePlayers.has(white.id) : false;

  const score = ctx.territory?.score ?? ctx.settledScore;
  const komi = ctx.initialProps.komi;

  let bStr: string;
  let wStr: string;
  if (score) {
    ({ bStr, wStr } = formatScoreStr(score, komi));
  } else {
    bStr = `${formatN(ctx.gameState.captures.black)} ${blackSymbol()}`;
    wStr = komi
      ? `${formatN(ctx.gameState.captures.white)}+${formatN(komi)} ${whiteSymbol()}`
      : `${formatN(ctx.gameState.captures.white)} ${whiteSymbol()}`;
  }

  if (ctx.playerStone === -1) {
    setLabel(topEl, bName, bStr, bOnline);
    setLabel(bottomEl, wName, wStr, wOnline);
  } else {
    setLabel(topEl, wName, wStr, wOnline);
    setLabel(bottomEl, bName, bStr, bOnline);
  }
}

export function updateStatus(
  ctx: GameCtx,
  statusEl: HTMLElement | null,
): void {
  if (!statusEl) {
    return;
  }
  if (ctx.gameStage === GameStage.TerritoryReview && ctx.territory) {
    const bCheck = ctx.territory.black_approved ? ` ${CHECKMARK}` : "";
    const wCheck = ctx.territory.white_approved ? ` ${CHECKMARK}` : "";
    const komi = ctx.initialProps.komi;
    const { bStr, wStr } = formatScoreStr(ctx.territory.score, komi);
    statusEl.textContent = `B: ${bStr}${bCheck}  |  W: ${wStr}${wCheck}`;
  } else {
    statusEl.textContent = "";
  }
}
