import { describe, expect, it } from "vitest";
import { aiPositionFromEngine, type AiPositionEngine } from "../ai/position";

function mockEngine(
  overrides: Partial<AiPositionEngine> = {},
): AiPositionEngine {
  return {
    board: () => Int8Array.from([1, 0, 0, 0, -1, 0, 0, 0, 1]),
    cols: () => 3,
    rows: () => 3,
    current_turn_stone: () => -1,
    has_ko: () => false,
    ko_col: () => -1,
    ko_row: () => -1,
    moves_json: () =>
      JSON.stringify([
        { kind: "play", stone: 1, pos: [0, 0] },
        { kind: "play", stone: -1, pos: [1, 1] },
        { kind: "pass", stone: 1, pos: null },
      ]),
    ...overrides,
  };
}

describe("aiPositionFromEngine", () => {
  it("exports board stones and side to move", () => {
    const position = aiPositionFromEngine(mockEngine(), 6.5);

    expect(position.boardSize).toBe(3);
    expect(position.nextPlayer).toBe("white");
    expect(position.komi).toBe(6.5);
    expect(position.stones).toEqual([
      { col: 0, row: 0, player: "black" },
      { col: 1, row: 1, player: "white" },
      { col: 2, row: 2, player: "black" },
    ]);
  });

  it("exports recent moves latest first", () => {
    const position = aiPositionFromEngine(mockEngine(), 6.5);

    expect(position.recentMoves).toEqual([
      { kind: "pass", player: "black" },
      { kind: "play", col: 1, row: 1, player: "white" },
      { kind: "play", col: 0, row: 0, player: "black" },
    ]);
  });

  it("exports ko when present", () => {
    const position = aiPositionFromEngine(
      mockEngine({
        has_ko: () => true,
        ko_col: () => 2,
        ko_row: () => 1,
      }),
      6.5,
    );

    expect(position.ko).toEqual({ col: 2, row: 1 });
  });

  it("rejects non-square boards", () => {
    expect(() =>
      aiPositionFromEngine(
        mockEngine({
          rows: () => 4,
        }),
        6.5,
      ),
    ).toThrow("square board");
  });
});
