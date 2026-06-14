import type { AiPocRandomMctsEdge, AiPocRandomMctsMove } from "../ai-poc/types";

export type BotMoveChoice = {
  move: AiPocRandomMctsMove;
  reason: "policy" | "opponent-pass-score" | "fallback-pass";
};

const PASS_WHEN_BOT_LEAD_AT_LEAST = -0.5;

export function chooseBotMove(options: {
  rootMoves: AiPocRandomMctsEdge[];
  botStone: 1 | -1;
  lastMoveWasPass: boolean;
  whiteScoreMean?: number;
}): BotMoveChoice {
  const policyMove = options.rootMoves[0]?.action;

  if (policyMove?.kind === "pass") {
    return { move: policyMove, reason: "policy" };
  }

  if (shouldPassAfterOpponentPass(options)) {
    return { move: { kind: "pass" }, reason: "opponent-pass-score" };
  }

  if (policyMove) {
    return { move: policyMove, reason: "policy" };
  }

  return { move: { kind: "pass" }, reason: "fallback-pass" };
}

function shouldPassAfterOpponentPass(options: {
  botStone: 1 | -1;
  lastMoveWasPass: boolean;
  whiteScoreMean?: number;
}): boolean {
  if (!options.lastMoveWasPass || options.whiteScoreMean == null) {
    return false;
  }

  const botLead =
    options.botStone === -1 ? options.whiteScoreMean : -options.whiteScoreMean;

  return botLead >= PASS_WHEN_BOT_LEAD_AT_LEAST;
}
