import type { Captures, ScoreData } from "../game/types";
import type { TerritoryOverlay } from "../goban/create-board";

const OWNERSHIP_NEUTRAL_THRESHOLD = 0.2;

export type BotFinalScore = {
  score: ScoreData;
  overlay: TerritoryOverlay;
};

export function scoreBotGameFromOwnership(options: {
  board: number[];
  cols: number;
  rows: number;
  captures: Captures;
  ownership: number[];
}): BotFinalScore | undefined {
  const size = options.cols * options.rows;

  if (options.board.length !== size || options.ownership.length !== size) {
    return undefined;
  }

  const normalized = options.ownership.map(normalizeOwnership);
  const deadStones: [number, number][] = [];
  let blackTerritory = 0;
  let whiteTerritory = 0;
  let deadBlack = 0;
  let deadWhite = 0;

  for (let index = 0; index < size; index++) {
    const stone = options.board[index] ?? 0;
    const owner = normalized[index] ?? 0;

    if (stone === 1 && owner === -1) {
      deadBlack += 1;
      deadStones.push([index % options.cols, Math.floor(index / options.cols)]);
    } else if (stone === -1 && owner === 1) {
      deadWhite += 1;
      deadStones.push([index % options.cols, Math.floor(index / options.cols)]);
    } else if (stone === 0 && owner === 1) {
      blackTerritory += 1;
    } else if (stone === 0 && owner === -1) {
      whiteTerritory += 1;
    }
  }

  return {
    score: {
      black: {
        territory: blackTerritory,
        captures: options.captures.black + deadWhite,
      },
      white: {
        territory: whiteTerritory,
        captures: options.captures.white + deadBlack,
      },
    },
    overlay: {
      paintMap: normalized.map((owner) => (owner === 0 ? null : owner)),
      dimmedVertices: deadStones,
    },
  };
}

function normalizeOwnership(value: number): -1 | 0 | 1 {
  if (value > OWNERSHIP_NEUTRAL_THRESHOLD) {
    return 1;
  }

  if (value < -OWNERSHIP_NEUTRAL_THRESHOLD) {
    return -1;
  }

  return 0;
}
