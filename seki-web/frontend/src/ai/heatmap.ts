import type { AiPocRandomMctsEdge } from "../ai-poc/types";
import type { GhostStoneData, HeatData, Sign } from "../goban/types";

export function heatMapFromRootMoves(
  moves: AiPocRandomMctsEdge[],
  boardSize: number,
  options: { labelLimit?: number } = {},
): (HeatData | null)[] {
  const heatMap: (HeatData | null)[] = new Array(boardSize * boardSize).fill(
    null,
  );
  const playableMoves = moves.filter((move) => move.action.kind === "play");
  const maxPrior = Math.max(...playableMoves.map((move) => move.prior), 0);
  const labelLimit = options.labelLimit ?? 4;

  if (maxPrior <= 0) {
    return heatMap;
  }

  playableMoves.forEach((move, index) => {
    if (move.action.kind !== "play") {
      return;
    }

    const heatIndex = move.action.row * boardSize + move.action.col;
    const strength = Math.max(
      1,
      Math.min(9, Math.ceil((move.prior / maxPrior) * 9)),
    );

    heatMap[heatIndex] = {
      strength,
      text: index < labelLimit ? String(index + 1) : undefined,
    };
  });

  return heatMap;
}

export function ghostStoneMapFromRootMoves(
  moves: AiPocRandomMctsEdge[],
  boardSize: number,
  sign: Sign,
): (GhostStoneData | null)[] {
  const ghostStoneMap: (GhostStoneData | null)[] = new Array(
    boardSize * boardSize,
  ).fill(null);

  moves.forEach((move) => {
    if (move.action.kind !== "play") {
      return;
    }

    ghostStoneMap[move.action.row * boardSize + move.action.col] = {
      sign,
      faint: true,
    };
  });

  return ghostStoneMap;
}
