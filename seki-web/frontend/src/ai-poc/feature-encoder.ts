export type AiPocPlayer = "black" | "white";

export type AiPocRules = {
  koRule: "simple" | "positional" | "situational";
  scoring: "area" | "territory";
  tax: "none" | "seki" | "all";
  multiStoneSuicideLegal: boolean;
};

export type AiPocMove =
  | {
      kind: "play";
      col: number;
      row: number;
      player: AiPocPlayer;
    }
  | {
      kind: "pass";
      player: AiPocPlayer;
    };

export type AiPocStone = {
  col: number;
  row: number;
  player: AiPocPlayer;
};

export type AiPocPosition = {
  boardSize: number;
  nextPlayer: AiPocPlayer;
  komi: number;
  stones: AiPocStone[];
  recentMoves: AiPocMove[];
  ko?: { col: number; row: number };
  rules: AiPocRules;
};

export type AiPocEncodedFeatures = {
  binInput: Float32Array;
  globalInput: Float32Array;
  binShape: [number, number, number, number];
  globalShape: [number, number];
  summary: {
    encoding: "katago-v7-poc-subset";
    boardSize: number;
    nextPlayer: AiPocPlayer;
    komi: number;
    nonZeroBinaryFeatures: number;
    nonZeroGlobalFeatures: number;
    omittedFeatures: string[];
  };
};

const BIN_CHANNELS = 22;
const GLOBAL_CHANNELS = 19;

export function defaultAiPocRules(): AiPocRules {
  return {
    koRule: "positional",
    scoring: "area",
    tax: "none",
    multiStoneSuicideLegal: false,
  };
}

export function createAiPocPosition(
  preset: string,
  boardSize: number,
  nextPlayer: AiPocPlayer,
  komi: number,
): AiPocPosition {
  const rules = defaultAiPocRules();

  if (preset === "corner-exchange") {
    return {
      boardSize,
      nextPlayer,
      komi,
      rules,
      stones: [
        { col: 3, row: 3, player: "black" },
        { col: boardSize - 4, row: boardSize - 4, player: "white" },
      ],
      recentMoves: [
        {
          kind: "play",
          col: boardSize - 4,
          row: boardSize - 4,
          player: "white",
        },
        { kind: "play", col: 3, row: 3, player: "black" },
      ],
    };
  }

  return {
    boardSize,
    nextPlayer,
    komi,
    rules,
    stones: [],
    recentMoves: [],
  };
}

export function encodeKataGoV7PocFeatures(
  position: AiPocPosition,
): AiPocEncodedFeatures {
  if (position.boardSize <= 0) {
    throw new Error("Board size must be positive");
  }

  const board = makeBoard(position);
  const area = position.boardSize * position.boardSize;
  const binInput = new Float32Array(BIN_CHANNELS * area);
  const globalInput = new Float32Array(GLOBAL_CHANNELS);

  for (let row = 0; row < position.boardSize; row++) {
    for (let col = 0; col < position.boardSize; col++) {
      const index = pointIndex(col, row, position.boardSize);
      const stone = board[index];

      setBin(binInput, position.boardSize, 0, col, row, 1);

      if (stone === position.nextPlayer) {
        setBin(binInput, position.boardSize, 1, col, row, 1);
      } else if (stone && stone !== position.nextPlayer) {
        setBin(binInput, position.boardSize, 2, col, row, 1);
      }

      if (stone) {
        const liberties = countLiberties(board, position.boardSize, col, row);
        if (liberties >= 1 && liberties <= 3) {
          setBin(binInput, position.boardSize, liberties + 2, col, row, 1);
        }
      }
    }
  }

  if (position.ko) {
    setBin(
      binInput,
      position.boardSize,
      6,
      position.ko.col,
      position.ko.row,
      1,
    );
  }

  fillRecentMoveFeatures(position, binInput, globalInput);
  fillGlobalFeatures(position, globalInput);

  return {
    binInput,
    globalInput,
    binShape: [1, BIN_CHANNELS, position.boardSize, position.boardSize],
    globalShape: [1, GLOBAL_CHANNELS],
    summary: {
      encoding: "katago-v7-poc-subset",
      boardSize: position.boardSize,
      nextPlayer: position.nextPlayer,
      komi: position.komi,
      nonZeroBinaryFeatures: countNonZero(binInput),
      nonZeroGlobalFeatures: countNonZero(globalInput),
      omittedFeatures: [
        "superko bans",
        "encore ko bans",
        "territory/scoring area planes",
        "ladder features",
        "second encore stones",
        "pass-would-end-phase",
        "playout doubling",
        "button go",
      ],
    },
  };
}

function makeBoard(position: AiPocPosition): Array<AiPocPlayer | undefined> {
  const board = new Array<AiPocPlayer | undefined>(
    position.boardSize * position.boardSize,
  );

  for (const stone of position.stones) {
    assertPoint(position.boardSize, stone.col, stone.row);
    board[pointIndex(stone.col, stone.row, position.boardSize)] = stone.player;
  }

  return board;
}

function fillRecentMoveFeatures(
  position: AiPocPosition,
  binInput: Float32Array,
  globalInput: Float32Array,
) {
  const expectedPlayers = recentMoveExpectedPlayers(position.nextPlayer);

  for (let i = 0; i < Math.min(5, position.recentMoves.length); i++) {
    const move = position.recentMoves[i];

    if (move.player !== expectedPlayers[i]) {
      continue;
    }

    if (move.kind === "pass") {
      globalInput[i] = 1;
    } else {
      setBin(binInput, position.boardSize, 9 + i, move.col, move.row, 1);
    }
  }
}

function fillGlobalFeatures(
  position: AiPocPosition,
  globalInput: Float32Array,
) {
  const selfKomi =
    position.nextPlayer === "white" ? position.komi : -position.komi;
  const boardArea = position.boardSize * position.boardSize;
  const clippedSelfKomi = Math.max(
    -boardArea - 20,
    Math.min(boardArea + 20, selfKomi),
  );

  globalInput[5] = clippedSelfKomi / 20;

  if (position.rules.koRule === "positional") {
    globalInput[6] = 1;
    globalInput[7] = 0.5;
  } else if (position.rules.koRule === "situational") {
    globalInput[6] = 1;
    globalInput[7] = -0.5;
  }

  if (position.rules.multiStoneSuicideLegal) {
    globalInput[8] = 1;
  }

  if (position.rules.scoring === "territory") {
    globalInput[9] = 1;
  }

  if (position.rules.tax === "seki") {
    globalInput[10] = 1;
  } else if (position.rules.tax === "all") {
    globalInput[10] = 1;
    globalInput[11] = 1;
  }

  if (position.rules.scoring === "area") {
    globalInput[18] = komiParityWave(clippedSelfKomi, boardArea);
  }
}

function recentMoveExpectedPlayers(nextPlayer: AiPocPlayer): AiPocPlayer[] {
  const opponent = oppositePlayer(nextPlayer);

  return [opponent, nextPlayer, opponent, nextPlayer, opponent];
}

function countLiberties(
  board: Array<AiPocPlayer | undefined>,
  boardSize: number,
  col: number,
  row: number,
): number {
  const player = board[pointIndex(col, row, boardSize)];
  if (!player) {
    return 0;
  }

  const seen = new Set<number>();
  const liberties = new Set<number>();
  const stack = [pointIndex(col, row, boardSize)];

  while (stack.length > 0) {
    const index = stack.pop()!;
    if (seen.has(index)) {
      continue;
    }
    seen.add(index);

    const point = indexToPoint(index, boardSize);
    for (const neighbor of neighbors(boardSize, point.col, point.row)) {
      const neighborIndex = pointIndex(neighbor.col, neighbor.row, boardSize);
      const neighborStone = board[neighborIndex];

      if (!neighborStone) {
        liberties.add(neighborIndex);
      } else if (neighborStone === player && !seen.has(neighborIndex)) {
        stack.push(neighborIndex);
      }
    }
  }

  return liberties.size;
}

function komiParityWave(selfKomi: number, boardArea: number): number {
  const drawableKomisAreEven = boardArea % 2 === 0;
  const komiFloor = drawableKomisAreEven
    ? Math.floor(selfKomi / 2) * 2
    : Math.floor((selfKomi - 1) / 2) * 2 + 1;
  const delta = Math.max(0, Math.min(2, selfKomi - komiFloor));

  if (delta < 0.5) {
    return delta;
  }
  if (delta < 1.5) {
    return 1 - delta;
  }
  return delta - 2;
}

function setBin(
  binInput: Float32Array,
  boardSize: number,
  channel: number,
  col: number,
  row: number,
  value: number,
) {
  assertPoint(boardSize, col, row);
  binInput[channel * boardSize * boardSize + pointIndex(col, row, boardSize)] =
    value;
}

function pointIndex(col: number, row: number, boardSize: number): number {
  return row * boardSize + col;
}

function indexToPoint(index: number, boardSize: number) {
  return {
    col: index % boardSize,
    row: Math.floor(index / boardSize),
  };
}

function neighbors(boardSize: number, col: number, row: number) {
  return [
    { col: col - 1, row },
    { col: col + 1, row },
    { col, row: row - 1 },
    { col, row: row + 1 },
  ].filter(
    (point) =>
      point.col >= 0 &&
      point.row >= 0 &&
      point.col < boardSize &&
      point.row < boardSize,
  );
}

function oppositePlayer(player: AiPocPlayer): AiPocPlayer {
  return player === "black" ? "white" : "black";
}

function assertPoint(boardSize: number, col: number, row: number) {
  if (col < 0 || row < 0 || col >= boardSize || row >= boardSize) {
    throw new Error(
      `Point is outside ${boardSize}x${boardSize}: ${col},${row}`,
    );
  }
}

function countNonZero(values: Float32Array): number {
  let count = 0;

  for (const value of values) {
    if (value !== 0) {
      count++;
    }
  }

  return count;
}
