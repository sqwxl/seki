import { describe, expect, it } from "vitest";
import type { AiPocRandomMctsEdge } from "../ai-poc/types";
import { chooseBotMove } from "../layouts/bot-move";

const play = (col: number, row: number): AiPocRandomMctsEdge => ({
  action: { kind: "play", col, row },
  visits: 0,
  prior: 1,
  value: 0,
});

const pass: AiPocRandomMctsEdge = {
  action: { kind: "pass" },
  visits: 0,
  prior: 1,
  value: 0,
};

describe("chooseBotMove", () => {
  it("keeps the policy pass when pass is the top move", () => {
    expect(
      chooseBotMove({
        rootMoves: [pass, play(4, 4)],
        botStone: 1,
        lastMoveWasPass: false,
        whiteScoreMean: 10,
      }),
    ).toEqual({ move: { kind: "pass" }, reason: "policy" });
  });

  it("passes as white after an opponent pass when white is not behind", () => {
    expect(
      chooseBotMove({
        rootMoves: [play(4, 4)],
        botStone: -1,
        lastMoveWasPass: true,
        whiteScoreMean: 0.5,
      }),
    ).toEqual({ move: { kind: "pass" }, reason: "opponent-pass-score" });
  });

  it("passes as black after an opponent pass when black is not behind", () => {
    expect(
      chooseBotMove({
        rootMoves: [play(4, 4)],
        botStone: 1,
        lastMoveWasPass: true,
        whiteScoreMean: -0.5,
      }),
    ).toEqual({ move: { kind: "pass" }, reason: "opponent-pass-score" });
  });

  it("keeps playing after an opponent pass when the bot is behind", () => {
    expect(
      chooseBotMove({
        rootMoves: [play(4, 4)],
        botStone: -1,
        lastMoveWasPass: true,
        whiteScoreMean: -1,
      }),
    ).toEqual({ move: { kind: "play", col: 4, row: 4 }, reason: "policy" });
  });

  it("keeps playing when the opponent did not just pass", () => {
    expect(
      chooseBotMove({
        rootMoves: [play(4, 4)],
        botStone: -1,
        lastMoveWasPass: false,
        whiteScoreMean: 10,
      }),
    ).toEqual({ move: { kind: "play", col: 4, row: 4 }, reason: "policy" });
  });

  it("passes when no policy move is available", () => {
    expect(
      chooseBotMove({
        rootMoves: [],
        botStone: -1,
        lastMoveWasPass: false,
      }),
    ).toEqual({ move: { kind: "pass" }, reason: "fallback-pass" });
  });
});
