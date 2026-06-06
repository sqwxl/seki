import { describe, expect, it } from "vitest";
import {
  createAiPocPosition,
  encodeKataGoV7PocFeatures,
} from "../ai-poc/feature-encoder";

function binAt(
  binInput: Float32Array,
  boardSize: number,
  channel: number,
  col: number,
  row: number,
) {
  return binInput[channel * boardSize * boardSize + row * boardSize + col];
}

describe("KataGo v7 PoC feature encoder", () => {
  it("encodes an empty board with on-board and global rule features", () => {
    const position = createAiPocPosition("empty", 19, "black", 6.5);
    const encoded = encodeKataGoV7PocFeatures(position);

    expect(encoded.binShape).toEqual([1, 22, 19, 19]);
    expect(encoded.globalShape).toEqual([1, 19]);
    expect(encoded.summary.nonZeroBinaryFeatures).toBe(361);
    expect(encoded.summary.nonZeroGlobalFeatures).toBe(4);
    expect(encoded.globalInput[5]).toBeCloseTo(-6.5 / 20);
    expect(encoded.globalInput[6]).toBe(1);
    expect(encoded.globalInput[7]).toBe(0.5);
    expect(encoded.globalInput[18]).toBeCloseTo(0.5);
    expect(binAt(encoded.binInput, 19, 0, 0, 0)).toBe(1);
    expect(binAt(encoded.binInput, 19, 1, 0, 0)).toBe(0);
    expect(binAt(encoded.binInput, 19, 2, 0, 0)).toBe(0);
  });

  it("encodes current-player stones, opponent stones, and recent moves", () => {
    const position = createAiPocPosition("corner-exchange", 19, "black", 6.5);
    const encoded = encodeKataGoV7PocFeatures(position);

    expect(binAt(encoded.binInput, 19, 1, 3, 3)).toBe(1);
    expect(binAt(encoded.binInput, 19, 2, 15, 15)).toBe(1);
    expect(binAt(encoded.binInput, 19, 9, 15, 15)).toBe(1);
    expect(binAt(encoded.binInput, 19, 10, 3, 3)).toBe(1);
  });

  it("creates Li/Jiang pro-game presets from the mainline", () => {
    const position = createAiPocPosition("li-jiang-move-32", 19, "white", 7.5);
    const encoded = encodeKataGoV7PocFeatures(position);

    expect(position.nextPlayer).toBe("black");
    expect(position.recentMoves).toHaveLength(32);
    expect(position.recentMoves[0]).toEqual({
      kind: "play",
      col: 13,
      row: 5,
      player: "white",
    });
    expect(binAt(encoded.binInput, 19, 1, 15, 3)).toBe(1);
    expect(binAt(encoded.binInput, 19, 2, 3, 2)).toBe(1);
    expect(binAt(encoded.binInput, 19, 9, 13, 5)).toBe(1);
    expect(binAt(encoded.binInput, 19, 10, 12, 5)).toBe(1);
  });

  it("replays the later Li/Jiang mainline preset", () => {
    const position = createAiPocPosition("li-jiang-move-120", 19, "white", 7.5);

    expect(position.nextPlayer).toBe("black");
    expect(position.recentMoves[0]).toEqual({
      kind: "play",
      col: 8,
      row: 1,
      player: "white",
    });
    expect(position.stones.length).toBeLessThan(120);
  });

  it("creates KataGo-derived 9x9 sparse search preset", () => {
    const position = createAiPocPosition(
      "katago-search-sparse-9x9",
      9,
      "white",
      6.5,
    );

    expect(position.nextPlayer).toBe("black");
    expect(
      position.stones.filter((stone) => stone.player === "black"),
    ).toHaveLength(4);
    expect(
      position.stones.filter((stone) => stone.player === "white"),
    ).toHaveLength(4);
    expect(position.stones).toContainEqual({ col: 2, row: 2, player: "black" });
    expect(position.stones).toContainEqual({ col: 5, row: 2, player: "white" });
    expect(position.recentMoves).toHaveLength(0);
  });

  it("creates KataGo-derived 9x9 local contact preset", () => {
    const position = createAiPocPosition(
      "katago-local-contact-9x9",
      9,
      "black",
      6.5,
    );

    expect(position.nextPlayer).toBe("white");
    expect(
      position.stones.filter((stone) => stone.player === "black"),
    ).toHaveLength(3);
    expect(
      position.stones.filter((stone) => stone.player === "white"),
    ).toHaveLength(2);
    expect(position.stones).toContainEqual({ col: 4, row: 3, player: "black" });
    expect(position.stones).toContainEqual({ col: 4, row: 4, player: "white" });
    expect(position.recentMoves).toHaveLength(0);
  });

  it("rejects KataGo 9x9 presets on other board sizes", () => {
    expect(() =>
      createAiPocPosition("katago-search-sparse-9x9", 19, "black", 6.5),
    ).toThrow("requires a 9x9 board");
  });

  it("marks one-liberty chains", () => {
    const position = createAiPocPosition("empty", 19, "white", 6.5);
    position.stones = [
      { col: 0, row: 0, player: "black" },
      { col: 1, row: 0, player: "white" },
    ];

    const encoded = encodeKataGoV7PocFeatures(position);

    expect(binAt(encoded.binInput, 19, 2, 0, 0)).toBe(1);
    expect(binAt(encoded.binInput, 19, 3, 0, 0)).toBe(1);
  });
});
