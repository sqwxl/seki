import { describe, expect, it } from "vitest";
import { createAiPocPosition } from "../ai-poc/feature-encoder";
import { runPolicyMcts } from "../ai-poc/mcts";

describe("runPolicyMcts", () => {
  it("uses policy priors to focus visits", async () => {
    const position = createAiPocPosition("empty", 9, "black", 6.5);
    const result = await runPolicyMcts(
      position,
      { visits: 16, maxChildren: 8 },
      async (nextPosition) => {
        const policy = new Float32Array(
          nextPosition.boardSize * nextPosition.boardSize + 1,
        );

        policy[2 * nextPosition.boardSize + 2] = 3;
        policy[6 * nextPosition.boardSize + 6] = 2;

        return {
          policy,
          value: 0.2,
        };
      },
    );

    expect(result.visits).toBe(16);
    expect(result.bestMove).toBe("C7");
    expect(result.topMoves[0]).toMatchObject({
      move: "C7",
    });
    expect(result.topMoves[0]!.visits).toBeGreaterThan(0);
  });
});
