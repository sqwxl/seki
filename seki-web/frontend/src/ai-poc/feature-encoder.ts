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
const LI_JIANG_BOARD_SIZE = 19;
const LI_JIANG_PRO_GAME_PRESETS: Record<string, number> = {
  "li-jiang-move-32": 32,
  "li-jiang-move-72": 72,
  "li-jiang-move-120": 120,
};
const LI_JIANG_MAINLINE_COORDS = [
  "pd dc qp dq ce fd co ep op ci cl qc qd pc nc oc od nb pj nd mc mb lc ne le lf rc rb re sc mf nf kf qg fe de df ee ef cf",
  "cg bf bg be ff gd pg pf qf lg mg ph rg og qi mh lh kg nh mi me ng ni ke lb nj mj li nk jf ic qh rh oe cd bd cc cb oj qe",
  "pe rd kh jh ki lj ji lk ih jg kl ll lm ml kk mm ie jd id hf hg if he ii ij jc jb ib kc ja kb ge gf hc hb ha ia md ld ib",
]
  .join(" ")
  .split(" ");
const KATAGO_BOARD_PRESETS: Record<
  string,
  {
    boardSize: number;
    nextPlayer: AiPocPlayer;
    rows: string[];
  }
> = {
  "katago-search-sparse-9x9": {
    boardSize: 9,
    nextPlayer: "black",
    rows: [
      ".........",
      ".........",
      "..x..o...",
      ".........",
      "..x...o..",
      "...o.....",
      "..o.x.x..",
      ".........",
      ".........",
    ],
  },
  "katago-local-contact-9x9": {
    boardSize: 9,
    nextPlayer: "white",
    rows: [
      ".........",
      ".........",
      ".........",
      "....x....",
      "....ox...",
      "....xo...",
      ".........",
      ".........",
      ".........",
    ],
  },
};

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
  const proGameMoveCount = LI_JIANG_PRO_GAME_PRESETS[preset];

  if (proGameMoveCount !== undefined) {
    return createLiJiangProGamePosition(proGameMoveCount, boardSize, komi);
  }

  if (KATAGO_BOARD_PRESETS[preset]) {
    return createKataGoBoardPreset(preset, boardSize, komi);
  }

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

function createKataGoBoardPreset(
  preset: string,
  boardSize: number,
  komi: number,
): AiPocPosition {
  const boardPreset = KATAGO_BOARD_PRESETS[preset];
  if (!boardPreset) {
    throw new Error(`Unknown KataGo board preset: ${preset}`);
  }
  if (boardSize !== boardPreset.boardSize) {
    throw new Error(
      `KataGo preset ${preset} requires a ${boardPreset.boardSize}x${boardPreset.boardSize} board`,
    );
  }

  return {
    boardSize,
    nextPlayer: boardPreset.nextPlayer,
    komi,
    rules: defaultAiPocRules(),
    stones: stonesFromAsciiBoard(boardPreset.rows),
    recentMoves: [],
  };
}

function createLiJiangProGamePosition(
  moveCount: number,
  boardSize: number,
  komi: number,
): AiPocPosition {
  if (boardSize !== LI_JIANG_BOARD_SIZE) {
    throw new Error("Li/Jiang pro-game presets require a 19x19 board");
  }

  const moves = LI_JIANG_MAINLINE_COORDS.slice(0, moveCount).map(
    (coord, index) => ({
      kind: "play" as const,
      ...sgfCoordToPoint(coord),
      player: index % 2 === 0 ? ("black" as const) : ("white" as const),
    }),
  );
  const board = new Array<AiPocPlayer | undefined>(boardSize * boardSize);

  for (const move of moves) {
    applyMoveToBoard(board, boardSize, move);
  }

  return {
    boardSize,
    nextPlayer: moveCount % 2 === 0 ? "black" : "white",
    komi,
    rules: defaultAiPocRules(),
    stones: stonesFromBoard(board, boardSize),
    recentMoves: [...moves].reverse(),
  };
}

function stonesFromAsciiBoard(rows: string[]): AiPocStone[] {
  const stones: AiPocStone[] = [];

  rows.forEach((row, rowIndex) => {
    for (let col = 0; col < row.length; col++) {
      const char = row[col];

      if (char === "x") {
        stones.push({ col, row: rowIndex, player: "black" });
      } else if (char === "o") {
        stones.push({ col, row: rowIndex, player: "white" });
      } else if (char !== ".") {
        throw new Error(`Unsupported KataGo board preset char: ${char}`);
      }
    }
  });

  return stones;
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

function applyMoveToBoard(
  board: Array<AiPocPlayer | undefined>,
  boardSize: number,
  move: Extract<AiPocMove, { kind: "play" }>,
) {
  assertPoint(boardSize, move.col, move.row);

  const index = pointIndex(move.col, move.row, boardSize);
  if (board[index]) {
    throw new Error(`Li/Jiang pro-game preset has occupied move ${index}`);
  }

  board[index] = move.player;

  for (const neighbor of neighbors(boardSize, move.col, move.row)) {
    const neighborIndex = pointIndex(neighbor.col, neighbor.row, boardSize);
    if (board[neighborIndex] !== oppositePlayer(move.player)) {
      continue;
    }

    const group = collectGroup(board, boardSize, neighborIndex);
    if (countGroupLiberties(board, boardSize, group) === 0) {
      removeGroup(board, group);
    }
  }

  const ownGroup = collectGroup(board, boardSize, index);
  if (countGroupLiberties(board, boardSize, ownGroup) === 0) {
    throw new Error(`Li/Jiang pro-game preset has suicide move ${index}`);
  }
}

function collectGroup(
  board: Array<AiPocPlayer | undefined>,
  boardSize: number,
  startIndex: number,
): number[] {
  const player = board[startIndex];
  if (!player) {
    return [];
  }

  const group: number[] = [];
  const seen = new Set<number>();
  const stack = [startIndex];

  while (stack.length > 0) {
    const index = stack.pop()!;
    if (seen.has(index)) {
      continue;
    }
    seen.add(index);
    group.push(index);

    const point = indexToPoint(index, boardSize);
    for (const neighbor of neighbors(boardSize, point.col, point.row)) {
      const neighborIndex = pointIndex(neighbor.col, neighbor.row, boardSize);
      if (board[neighborIndex] === player && !seen.has(neighborIndex)) {
        stack.push(neighborIndex);
      }
    }
  }

  return group;
}

function countGroupLiberties(
  board: Array<AiPocPlayer | undefined>,
  boardSize: number,
  group: number[],
): number {
  const liberties = new Set<number>();

  for (const index of group) {
    const point = indexToPoint(index, boardSize);
    for (const neighbor of neighbors(boardSize, point.col, point.row)) {
      const neighborIndex = pointIndex(neighbor.col, neighbor.row, boardSize);
      if (!board[neighborIndex]) {
        liberties.add(neighborIndex);
      }
    }
  }

  return liberties.size;
}

function removeGroup(board: Array<AiPocPlayer | undefined>, group: number[]) {
  for (const index of group) {
    board[index] = undefined;
  }
}

function stonesFromBoard(
  board: Array<AiPocPlayer | undefined>,
  boardSize: number,
): AiPocStone[] {
  const stones: AiPocStone[] = [];

  for (let index = 0; index < board.length; index++) {
    const player = board[index];
    if (!player) {
      continue;
    }

    const point = indexToPoint(index, boardSize);
    stones.push({ ...point, player });
  }

  return stones;
}

function sgfCoordToPoint(coord: string) {
  if (coord.length !== 2) {
    throw new Error(`Unsupported SGF point in Li/Jiang preset: ${coord}`);
  }

  return {
    col: coord.charCodeAt(0) - "a".charCodeAt(0),
    row: coord.charCodeAt(1) - "a".charCodeAt(0),
  };
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
