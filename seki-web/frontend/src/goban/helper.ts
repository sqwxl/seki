import type { Point } from "./types";

export const avg = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((sum, x) => sum + x, 0) / xs.length;

export const range = (n: number): number[] =>
  Array(n)
    .fill(0)
    .map((_, i) => i);

export const random = (n: number): number =>
  Math.floor(Math.random() * (n + 1));

export const neighborhood = ([x, y]: Point): Point[] => [
  [x, y],
  [x - 1, y],
  [x + 1, y],
  [x, y - 1],
  [x, y + 1],
];

export const vertexEquals = (
  [x1, y1]: readonly number[],
  [x2, y2]: readonly number[],
): boolean => x1 === x2 && y1 === y2;

export const lineEquals = (
  [v1, w1]: [Point, Point],
  [v2, w2]: [Point, Point],
): boolean => vertexEquals(v1, v2) && vertexEquals(w1, w2);

export const signEquals = (...xs: (number | null | undefined)[]): boolean =>
  xs.length === 0
    ? true
    : xs.every((x) => Math.sign(x ?? 0) === Math.sign(xs[0] ?? 0));

export function getHoshis(width: number, height: number): Point[] {
  if (Math.min(width, height) <= 6) return [];

  const [nearX, nearY] = [width, height].map((x) => (x >= 13 ? 3 : 2));
  const [farX, farY] = [width - nearX - 1, height - nearY - 1];
  const [middleX, middleY] = [width, height].map((x) => (x - 1) / 2);

  const result: Point[] = [
    [nearX, farY],
    [farX, nearY],
    [farX, farY],
    [nearX, nearY],
  ];

  if (width % 2 !== 0 && height % 2 !== 0 && width !== 7 && height !== 7)
    result.push([middleX, middleY]);
  if (width % 2 !== 0 && width !== 7)
    result.push([middleX, nearY], [middleX, farY]);
  if (height % 2 !== 0 && height !== 7)
    result.push([nearX, middleY], [farX, middleY]);

  return result;
}

export function readjustShifts(
  shiftMap: number[],
  cols: number,
  index: number | null = null,
): number[] {
  if (index == null) {
    for (let i = 0; i < shiftMap.length; i++) {
      readjustShifts(shiftMap, cols, i);
    }
  } else {
    const rows = shiftMap.length / cols;
    const x = index % cols;
    const y = Math.floor(index / cols);
    const direction = shiftMap[index];

    const neighbors: [number[], [number, number], number[]][] = [
      [[1, 5, 8], [x - 1, y], [3, 7, 6]],
      [[2, 5, 6], [x, y - 1], [4, 7, 8]],
      [[3, 7, 6], [x + 1, y], [1, 5, 8]],
      [[4, 7, 8], [x, y + 1], [2, 5, 6]],
    ];

    for (const [directions, [qx, qy], removeShifts] of neighbors) {
      if (!directions.includes(direction)) continue;
      if (qx < 0 || qx >= cols || qy < 0 || qy >= rows) continue;
      const qi = qy * cols + qx;
      if (removeShifts.includes(shiftMap[qi])) {
        shiftMap[qi] = 0;
      }
    }
  }

  return shiftMap;
}

export function diffSignMap(before: number[], after: number[]): number[] {
  if (
    before === after ||
    before.length === 0 ||
    before.length !== after.length
  ) {
    return [];
  }

  const result = [];

  for (let i = 0; i < before.length; i++) {
    if (before[i] === 0 && after[i] != null && after[i]) {
      result.push(i);
    }
  }

  return result;
}
