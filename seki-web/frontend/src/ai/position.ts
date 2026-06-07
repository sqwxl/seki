import {
  defaultAiPocRules,
  type AiPocMove,
  type AiPocPlayer,
  type AiPocPosition,
  type AiPocStone,
} from "../ai-poc/feature-encoder";

type WasmTurn = {
  kind: "play" | "pass" | "resign";
  stone: number;
  pos?: [number, number] | null;
};

export type AiPositionEngine = {
  board(): Int8Array | number[];
  cols(): number;
  rows(): number;
  current_turn_stone(): number;
  has_ko(): boolean;
  ko_col(): number;
  ko_row(): number;
  moves_json(): string;
  captures_black?(): number;
  captures_white?(): number;
};

export function aiPositionFromEngine(
  engine: AiPositionEngine,
  komi: number,
): AiPocPosition {
  const cols = engine.cols();
  const rows = engine.rows();

  if (cols !== rows) {
    throw new Error("AI position export requires a square board");
  }

  return {
    boardSize: cols,
    nextPlayer: playerFromStone(engine.current_turn_stone()),
    komi,
    stones: stonesFromBoard(engine.board(), cols),
    recentMoves: recentMovesFromJson(engine.moves_json()),
    captures: {
      black: engine.captures_black?.() ?? 0,
      white: engine.captures_white?.() ?? 0,
    },
    ko: engine.has_ko()
      ? {
          col: engine.ko_col(),
          row: engine.ko_row(),
        }
      : undefined,
    rules: defaultAiPocRules(),
  };
}

export function aiEstimatePositionFromEngine(
  engine: AiPositionEngine,
  komi: number,
): AiPocPosition {
  return {
    ...aiPositionFromEngine(engine, komi),
    nextPlayer: "black",
    recentMoves: [],
    ko: undefined,
  };
}

function stonesFromBoard(board: Int8Array | number[], boardSize: number) {
  const stones: AiPocStone[] = [];

  board.forEach((value, index) => {
    if (value === 0) {
      return;
    }

    stones.push({
      col: index % boardSize,
      row: Math.floor(index / boardSize),
      player: playerFromStone(value),
    });
  });

  return stones;
}

function recentMovesFromJson(movesJson: string): AiPocMove[] {
  const turns = JSON.parse(movesJson) as WasmTurn[];

  return turns
    .filter((turn) => turn.kind === "play" || turn.kind === "pass")
    .slice(-5)
    .reverse()
    .map((turn) => {
      const player = playerFromStone(turn.stone);

      if (turn.kind === "pass") {
        return { kind: "pass", player };
      }

      const [col, row] = turn.pos ?? [];
      if (col === undefined || row === undefined) {
        throw new Error("AI position export found a play turn without a point");
      }

      return {
        kind: "play",
        col,
        row,
        player,
      };
    });
}

function playerFromStone(stone: number): AiPocPlayer {
  if (stone > 0) {
    return "black";
  }
  if (stone < 0) {
    return "white";
  }

  throw new Error(`Invalid AI stone value: ${stone}`);
}
