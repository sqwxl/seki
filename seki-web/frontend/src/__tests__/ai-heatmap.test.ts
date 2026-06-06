import { describe, expect, it } from "vitest";
import type { AiPocRandomMctsEdge } from "../ai-poc/types";
import { heatMapFromRootMoves } from "../ai/heatmap";

describe("heatMapFromRootMoves", () => {
  it("maps legal play priors to goban heat entries", () => {
    const heatMap = heatMapFromRootMoves(
      [
        edge(2, 1, 0.5),
        edge(0, 0, 0.25),
        { action: { kind: "pass" }, visits: 0, prior: 0.9, value: 0 },
      ],
      3,
    );

    expect(heatMap[7]).toEqual({ strength: 9, text: "1" });
    expect(heatMap[0]).toEqual({ strength: 5, text: "2" });
    expect(heatMap.filter(Boolean)).toHaveLength(2);
  });

  it("caps labels without dropping heat", () => {
    const heatMap = heatMapFromRootMoves(
      [edge(0, 0, 0.4), edge(1, 1, 0.2)],
      3,
      {
        labelLimit: 1,
      },
    );

    expect(heatMap[0]).toEqual({ strength: 9, text: "1" });
    expect(heatMap[4]).toEqual({ strength: 5, text: undefined });
  });

  it("returns an empty heat map when priors have no signal", () => {
    const heatMap = heatMapFromRootMoves([edge(0, 0, 0)], 3);

    expect(heatMap).toHaveLength(9);
    expect(heatMap.every((entry) => entry === null)).toBe(true);
  });
});

function edge(row: number, col: number, prior: number): AiPocRandomMctsEdge {
  return {
    action: { kind: "play", row, col },
    visits: 0,
    prior,
    value: 0,
  };
}
