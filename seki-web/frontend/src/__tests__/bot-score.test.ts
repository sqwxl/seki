import { describe, expect, it } from "vitest";
import { scoreBotGameFromEngine } from "../layouts/bot-score";

describe("scoreBotGameFromEngine", () => {
  it("uses engine score and ownership for final territory", () => {
    const result = scoreBotGameFromEngine({
      cols: 2,
      rows: 2,
      scoreJson: JSON.stringify({
        black: { territory: 2, captures: 3 },
        white: { territory: 1, captures: 4 },
      }),
      ownershipJson: JSON.stringify([1, 0, -1, 1]),
      deadStonesJson: JSON.stringify([[1, 0]]),
    });

    expect(result?.score).toEqual({
      black: { territory: 2, captures: 3 },
      white: { territory: 1, captures: 4 },
    });
    expect(result?.overlay).toEqual({
      paintMap: [1, null, -1, 1],
      dimmedVertices: [[1, 0]],
    });
  });

  it("does not infer dead stones from ownership alone", () => {
    const result = scoreBotGameFromEngine({
      cols: 3,
      rows: 1,
      scoreJson: JSON.stringify({
        black: { territory: 1, captures: 0 },
        white: { territory: 0, captures: 0 },
      }),
      ownershipJson: JSON.stringify([-1, 1, 1]),
      deadStonesJson: JSON.stringify([]),
    });

    expect(result?.overlay.dimmedVertices).toEqual([]);
  });

  it("marks a whole engine-dead chain even when ownership looks alive", () => {
    const result = scoreBotGameFromEngine({
      cols: 3,
      rows: 3,
      scoreJson: JSON.stringify({
        black: { territory: 4, captures: 5 },
        white: { territory: 0, captures: 0 },
      }),
      ownershipJson: JSON.stringify([1, 1, 1, 1, 1, 1, 1, 1, 1]),
      deadStonesJson: JSON.stringify([
        [1, 0],
        [1, 1],
        [1, 2],
      ]),
    });

    expect(result?.overlay.dimmedVertices).toEqual([
      [1, 0],
      [1, 1],
      [1, 2],
    ]);
    expect(result?.score.black.captures).toBe(5);
  });

  it("rejects mismatched ownership size", () => {
    expect(
      scoreBotGameFromEngine({
        cols: 2,
        rows: 2,
        scoreJson: JSON.stringify({
          black: { territory: 0, captures: 0 },
          white: { territory: 0, captures: 0 },
        }),
        ownershipJson: JSON.stringify([1, 1, 1]),
        deadStonesJson: JSON.stringify([]),
      }),
    ).toBeUndefined();
  });
});
