import { GameStage } from "./goban/types";
import type { GameCtx } from "./game-context";
import { formatGameDescription } from "./format";

const BLACK_SYMBOL = "●";
const WHITE_SYMBOL = "○";
const BLACK_CAPTURES_SYMBOL = "⚉";
const WHITE_CAPTURES_SYMBOL = "⚇";
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

function formatPoints(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(1);
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
  const bName = `${BLACK_SYMBOL} ${black ? black.display_name : "…"}`;
  const wName = `${WHITE_SYMBOL} ${white ? white.display_name : "…"}`;
  const bOnline = black ? ctx.onlinePlayers.has(black.id) : false;
  const wOnline = white ? ctx.onlinePlayers.has(white.id) : false;

  let bPoints: number;
  let wPoints: number;
  if (ctx.territory) {
    bPoints = ctx.territory.score.black;
    wPoints = ctx.territory.score.white;
  } else {
    bPoints = ctx.gameState.captures.black;
    wPoints = ctx.gameState.captures.white + ctx.initialProps.komi;
  }

  const bStr = `${formatPoints(bPoints)} ${BLACK_CAPTURES_SYMBOL}`;
  const wStr = `${formatPoints(wPoints)} ${WHITE_CAPTURES_SYMBOL}`;

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
    statusEl.textContent = `B: ${ctx.territory.score.black}${bCheck}  |  W: ${ctx.territory.score.white}${wCheck}`;
  } else {
    statusEl.textContent = "";
  }
}
