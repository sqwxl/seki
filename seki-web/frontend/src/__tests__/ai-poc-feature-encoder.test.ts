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
