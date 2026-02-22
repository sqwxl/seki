import { GameStage, isPlayStage } from "./goban/types";
import type { ScoreData } from "./goban/types";
import type { GameCtx } from "./game-context";
import {
  formatGameDescription,
  blackSymbol,
  whiteSymbol,
  formatPoints,
} from "./format";
import {
  stoneBlackSvg,
  stoneWhiteSvg,
  capturesBlackSvg,
  capturesWhiteSvg,
} from "./icons";
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
  stone: "black" | "white";
  clock?: string;
  profileUrl?: string;
  isOnline?: boolean;
  isTurn?: boolean;
};

export function setLabel(el: HTMLElement, opts: LabelOpts): void {
  const stoneIconEl = el.querySelector(".stone-icon");
  const nameEl = el.querySelector(".player-name");
  const capturesIconEl = el.querySelector(".captures-icon");
  const pointsEl = el.querySelector(".player-captures");
  const clockEl = el.querySelector(".player-clock");
  const dotEl = el.querySelector(".presence-dot");
  const turnEl = el.querySelector(".turn-indicator");
  // Safe: SVG content is hardcoded constants from icons.ts, not user input
  if (stoneIconEl) {
    stoneIconEl.innerHTML = opts.stone === "black" ? stoneBlackSvg() : stoneWhiteSvg();
    stoneIconEl.setAttribute("data-stone", opts.stone);
  }
  if (nameEl) {
    if (opts.profileUrl) {
      let a = nameEl.querySelector("a");
      if (!a) {
        nameEl.textContent = "";
        a = document.createElement("a");
        nameEl.appendChild(a);
      }
      a.href = opts.profileUrl;
      a.textContent = opts.name;
    } else {
      nameEl.textContent = opts.name;
    }
  }
  if (capturesIconEl) {
    capturesIconEl.innerHTML = opts.stone === "black" ? capturesBlackSvg() : capturesWhiteSvg();
    capturesIconEl.setAttribute("data-stone", opts.stone);
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
  const bName = black ? black.display_name : "…";
  const wName = white ? white.display_name : "…";
  const bUrl = black ? `/users/${black.display_name}` : undefined;
  const wUrl = white ? `/users/${white.display_name}` : undefined;
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
      stone: "black",
      profileUrl: bUrl,
      isOnline: bOnline,
      isTurn: bTurn,
    });
    setLabel(bottomEl, {
      name: wName,
      captures: wStr,
      stone: "white",
      profileUrl: wUrl,
      isOnline: wOnline,
      isTurn: wTurn,
    });
  } else {
    setLabel(topEl, {
      name: wName,
      captures: wStr,
      stone: "white",
      profileUrl: wUrl,
      isOnline: wOnline,
      isTurn: wTurn,
    });
    setLabel(bottomEl, {
      name: bName,
      captures: bStr,
      stone: "black",
      profileUrl: bUrl,
      isOnline: bOnline,
      isTurn: bTurn,
    });
  }
}

export function updateStatus(
  ctx: GameCtx,
  statusEl: HTMLElement | null,
  countdownMs?: number,
): void {
  if (!statusEl) {
    return;
  }
  if (ctx.gameStage === GameStage.TerritoryReview && ctx.territory) {
    const bCheck = ctx.territory.black_approved ? ` ${CHECKMARK}` : "";
    const wCheck = ctx.territory.white_approved ? ` ${CHECKMARK}` : "";
    const komi = ctx.initialProps.komi;
    const { bStr, wStr } = formatScoreStr(ctx.territory.score, komi);
    let text = `${blackSymbol()} ${bStr}${bCheck}  |  ${whiteSymbol()} ${wStr}${wCheck}`;
    if (countdownMs != null) {
      const secs = Math.ceil(countdownMs / 1000);
      text += `  (${secs}s)`;
    }
    statusEl.textContent = text;
  } else {
    statusEl.textContent = "";
  }
}

export type TerritoryCountdown = {
  deadline: number | undefined;
  interval: ReturnType<typeof setInterval> | undefined;
  flagSent: boolean;
};

export function syncTerritoryCountdown(
  countdown: TerritoryCountdown,
  expiresAt: string | undefined,
  ctx: GameCtx,
  statusEl: HTMLElement | null,
  onFlag: () => void,
): void {
  if (countdown.interval) {
    clearInterval(countdown.interval);
    countdown.interval = undefined;
  }
  countdown.flagSent = false;

  if (expiresAt) {
    countdown.deadline = new Date(expiresAt).getTime();
    updateTerritoryCountdown(countdown, ctx, statusEl, onFlag);
    countdown.interval = setInterval(
      () => updateTerritoryCountdown(countdown, ctx, statusEl, onFlag),
      200,
    );
  } else {
    countdown.deadline = undefined;
    updateStatus(ctx, statusEl);
  }
}

function updateTerritoryCountdown(
  countdown: TerritoryCountdown,
  ctx: GameCtx,
  statusEl: HTMLElement | null,
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
  updateStatus(ctx, statusEl, Math.max(0, remaining));
}
