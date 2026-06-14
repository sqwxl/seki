import { describe, expect, it } from "vitest";
import { scoreBotGameFromOwnership } from "../layouts/bot-score";

describe("scoreBotGameFromOwnership", () => {
  it("normalizes AI ownership before scoring territory", () => {
    const result = scoreBotGameFromOwnership({
      board: [0, 0, 0, 0],
      cols: 2,
      rows: 2,
      captures: { black: 0, white: 0 },
      ownership: [0.9, 0.1, -0.9, -0.1],
    });

    expect(result?.score).toEqual({
      black: { territory: 1, captures: 0 },
      white: { territory: 1, captures: 0 },
    });
    expect(result?.overlay.paintMap).toEqual([1, null, -1, null]);
  });

  it("counts opponent-owned stones as dead captures", () => {
    const result = scoreBotGameFromOwnership({
      board: [1, -1, 0, 0],
      cols: 2,
      rows: 2,
      captures: { black: 2, white: 1 },
      ownership: [-0.9, 0.9, 0.9, -0.9],
    });

    expect(result?.score).toEqual({
      black: { territory: 1, captures: 3 },
      white: { territory: 1, captures: 2 },
    });
    expect(result?.overlay.dimmedVertices).toEqual([
      [0, 0],
      [1, 0],
    ]);
  });

  it("rejects mismatched board and ownership sizes", () => {
    expect(
      scoreBotGameFromOwnership({
        board: [0, 0, 0],
        cols: 2,
        rows: 2,
        captures: { black: 0, white: 0 },
        ownership: [1, 1, 1, 1],
      }),
    ).toBeUndefined();
  });
});
