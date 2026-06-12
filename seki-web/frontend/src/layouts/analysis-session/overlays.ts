import type { Board, TerritoryOverlay } from "../../goban/create-board";

export function estimateCacheKey(board: Board, komi: number): string {
  return JSON.stringify({
    size: board.engine.cols(),
    komi,
    capturesBlack: board.engine.captures_black?.() ?? 0,
    capturesWhite: board.engine.captures_white?.() ?? 0,
    board: Array.from(board.engine.board()),
  });
}

export function normalizedOwnershipForBoard(
  board: Board,
  nodeId: number | undefined,
  ownership: number[] | undefined,
): number[] | undefined {
  if (nodeId !== board.engine.current_node_id() || !ownership) {
    return undefined;
  }

  const size = board.engine.cols() * board.engine.rows();

  if (ownership.length !== size) {
    return undefined;
  }

  return ownership.map((value) =>
    Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0,
  );
}

export function buildAiOwnershipOverlay(
  board: Board,
  ownership: number[] | undefined,
): TerritoryOverlay | undefined {
  if (!ownership) {
    return undefined;
  }

  const cols = board.engine.cols();
  const rows = board.engine.rows();
  const size = cols * rows;

  if (ownership.length !== size) {
    return undefined;
  }

  const stones = [...board.engine.board()] as number[];
  const paintMap: (number | null)[] = new Array(size);
  const dimmedVertices: [number, number][] = [];

  for (let index = 0; index < size; index++) {
    const owner = Number.isFinite(ownership[index])
      ? Math.max(-1, Math.min(1, ownership[index]!))
      : 0;
    const stone = stones[index] ?? 0;

    if (stone !== 0 && owner !== 0 && Math.sign(stone) !== Math.sign(owner)) {
      dimmedVertices.push([index % cols, Math.floor(index / cols)]);
    }
    paintMap[index] = owner || null;
  }

  return { paintMap, dimmedVertices };
}
