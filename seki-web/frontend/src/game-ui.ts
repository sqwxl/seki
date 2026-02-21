import { GameStage, isPlayStage } from "./goban/types";
import type { ScoreData } from "./goban/types";
import type { GameCtx } from "./game-context";
import {
  formatGameDescription,
  blackSymbol,
  whiteSymbol,
  formatPoints,
} from "./format";
const CHECKMARK = "✓";

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

export function updateTitle(ctx: GameCtx, titleEl: HTMLElement | null): void {
  const desc = formatGameDescription({
    black: ctx.black,
    white: ctx.white,
    settings: ctx.initialProps.settings,
    stage: ctx.gameStage,
    result: ctx.result,
    move_count: ctx.moves.length > 0 ? ctx.moves.length : undefined,
  });
  if (titleEl) {
    titleEl.textContent = desc;
  }
  if (!flashInterval) {
    document.title = desc;
  } else {
    savedTitle = desc;
  }
}

export type LabelOpts = {
  name: string;
  captures: string;
  clock?: string;
  isOnline?: boolean;
  isTurn?: boolean;
};

export function setLabel(el: HTMLElement, opts: LabelOpts): void {
  const nameEl = el.querySelector(".player-name");
  const pointsEl = el.querySelector(".player-captures");
  const clockEl = el.querySelector(".player-clock");
  const dotEl = el.querySelector(".presence-dot");
  const turnEl = el.querySelector(".turn-indicator");
  if (nameEl) {
    nameEl.textContent = opts.name;
  }
  if (pointsEl) {
    pointsEl.textContent = opts.captures;
  }
  if (clockEl && opts.clock != null) {
    clockEl.textContent = opts.clock;
  }
  if (dotEl) {
    dotEl.classList.toggle("online", opts.isOnline ?? false);
  }
  if (turnEl) {
    turnEl.classList.toggle("active", opts.isTurn ?? false);
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
  const bOnline = black ? ctx.onlineUsers.has(black.id) : false;
  const wOnline = white ? ctx.onlineUsers.has(white.id) : false;
  const bTurn = ctx.gameStage === GameStage.BlackToPlay;
  const wTurn = ctx.gameStage === GameStage.WhiteToPlay;

  const score = ctx.territory?.score ?? ctx.settledScore;
  const komi = ctx.initialProps.komi;

  let bStr: string;
  let wStr: string;
  if (score) {
    ({ bStr, wStr } = formatScoreStr(score, komi));
  } else {
    const fmt = formatPoints(
      ctx.gameState.captures.black,
      ctx.gameState.captures.white,
      komi,
    );

    bStr = fmt.bStr;
    wStr = fmt.wStr;
  }

  if (ctx.playerStone === -1) {
    setLabel(topEl, {
      name: bName,
      captures: bStr,
      isOnline: bOnline,
      isTurn: bTurn,
    });
    setLabel(bottomEl, {
      name: wName,
      captures: wStr,
      isOnline: wOnline,
      isTurn: wTurn,
    });
  } else {
    setLabel(topEl, {
      name: wName,
      captures: wStr,
      isOnline: wOnline,
      isTurn: wTurn,
    });
    setLabel(bottomEl, {
      name: bName,
      captures: bStr,
      isOnline: bOnline,
      isTurn: bTurn,
    });
  }
}

export function updateStatus(ctx: GameCtx, statusEl: HTMLElement | null): void {
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
