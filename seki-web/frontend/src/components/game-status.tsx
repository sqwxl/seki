import type { ComponentType } from "preact";
import { GameStage } from "../game/types";
import type { ScoreData } from "../game/types";
import { formatResult } from "../utils/format";

export type GameStatusProps = {
  icon?: ComponentType;
  text: string;
};

export function GameStatus(props: GameStatusProps) {
  const Icon = props.icon;
  return (
    <div class="game-status">
      {Icon && <Icon />}
      <span>{props.text}</span>
    </div>
  );
}

export type StatusInput = {
  stage: GameStage;
  result?: string;
  komi: number;
  estimateScore?: ScoreData;
  territoryScore?: ScoreData;
  isBlackTurn?: boolean;
  // Challenge-specific
  challengeWaitingFor?: string;
  isChallengeCreator?: boolean;
  // Open game
  hasOpenSlot?: boolean;
};

export function getStatusText(input: StatusInput): string | undefined {
  // Estimate mode score takes priority
  if (input.estimateScore) {
    return formatResult(input.estimateScore, input.komi);
  }

  const { stage } = input;

  if (stage === GameStage.Challenge) {
    if (input.isChallengeCreator && input.challengeWaitingFor) {
      return `Waiting for ${input.challengeWaitingFor} to accept`;
    }
    if (!input.isChallengeCreator) {
      return "Waiting for your response";
    }
    return undefined;
  }

  if (stage === GameStage.Unstarted && input.hasOpenSlot) {
    return "Waiting for opponent";
  }

  if (stage === GameStage.BlackToPlay) {
    return "Black to play";
  }
  if (stage === GameStage.WhiteToPlay) {
    return "White to play";
  }

  if (stage === GameStage.TerritoryReview) {
    if (input.territoryScore) {
      return formatResult(input.territoryScore, input.komi);
    }
    return "Territory review";
  }

  if (
    (stage === GameStage.Completed || stage === GameStage.Aborted) &&
    input.result
  ) {
    return input.result;
  }

  // Fallback for analysis: use turn
  if (input.isBlackTurn !== undefined) {
    return input.isBlackTurn ? "Black to play" : "White to play";
  }

  return undefined;
}
