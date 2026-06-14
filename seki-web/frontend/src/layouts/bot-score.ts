import type { ScoreData } from "../game/types";
import type { TerritoryOverlay } from "../goban/create-board";

export type BotFinalScore = {
  score: ScoreData;
  overlay: TerritoryOverlay;
};

export function scoreBotGameFromEngine(options: {
  cols: number;
  rows: number;
  scoreJson: string;
  ownershipJson: string;
  deadStonesJson: string;
}): BotFinalScore | undefined {
  const size = options.cols * options.rows;
  const score = parseScore(options.scoreJson);
  const ownership = parseOwnership(options.ownershipJson, size);
  const deadStones = parseDeadStones(options.deadStonesJson);

  if (!score || !ownership || !deadStones) {
    return undefined;
  }

  return {
    score,
    overlay: {
      paintMap: ownership.map((owner) => (owner === 0 ? null : owner)),
      dimmedVertices: deadStones,
    },
  };
}

function parseScore(json: string): ScoreData | undefined {
  try {
    const parsed = JSON.parse(json) as Partial<ScoreData>;

    if (!isPlayerScore(parsed.black) || !isPlayerScore(parsed.white)) {
      return undefined;
    }

    return {
      black: parsed.black,
      white: parsed.white,
    };
  } catch {
    return undefined;
  }
}

function parseOwnership(
  json: string,
  size: number,
): (0 | 1 | -1)[] | undefined {
  try {
    const parsed = JSON.parse(json) as unknown;

    if (!Array.isArray(parsed) || parsed.length !== size) {
      return undefined;
    }

    return parsed.map((value) => normalizeOwner(Number(value)));
  } catch {
    return undefined;
  }
}

function parseDeadStones(json: string): [number, number][] | undefined {
  try {
    const parsed = JSON.parse(json) as unknown;

    if (!Array.isArray(parsed)) {
      return undefined;
    }

    const points: [number, number][] = [];

    for (const point of parsed) {
      if (
        !Array.isArray(point) ||
        point.length !== 2 ||
        !Number.isInteger(point[0]) ||
        !Number.isInteger(point[1])
      ) {
        return undefined;
      }

      points.push([point[0], point[1]]);
    }

    return points;
  } catch {
    return undefined;
  }
}

function isPlayerScore(value: unknown): value is ScoreData["black"] {
  return (
    typeof value === "object" &&
    value !== null &&
    Number.isFinite((value as ScoreData["black"]).territory) &&
    Number.isFinite((value as ScoreData["black"]).captures)
  );
}

function normalizeOwner(value: number): 0 | 1 | -1 {
  if (value > 0) {
    return 1;
  }

  if (value < 0) {
    return -1;
  }

  return 0;
}
