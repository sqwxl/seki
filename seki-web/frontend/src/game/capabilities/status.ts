import { computed } from "@preact/signals";
import { getStatusText } from "../../components/game-status";
import {
  canJoinGameFromProps,
  requiresAccessTokenToJoin,
  requiresInviteTokenToJoin,
} from "../access";
import { gamePhase } from "../phase";
import {
  black,
  boardFinalized,
  boardFinalizedScore,
  currentUserId,
  estimateScore,
  gameStage,
  initialProps,
  isPresenter,
  navState,
  opponent,
  opponentDisconnected,
  playerStone,
  presenterDisplayName,
  result,
  territory,
  uiNowMs,
  white,
} from "../state";
import { GameStage } from "../types";
import type { LiveGameStatusState } from "./types";

export const liveGameStatusState = computed((): LiveGameStatusState => {
  const phase = gamePhase.value;
  const stage = gameStage.value;
  const stone = playerStone.value;
  const isPlayer = stone !== 0;
  const isDone =
    stage === GameStage.Completed ||
    stage === GameStage.Aborted ||
    stage === GameStage.Declined;
  const res = result.value;
  const props = initialProps.value;
  const b = black.value;
  const w = white.value;
  const terr = territory.value;
  const oppDisconnected = opponentDisconnected.value;
  const myId = currentUserId.value || undefined;
  const isParticipant =
    myId != null &&
    (myId === props.creator_id ||
      myId === opponent.value?.id ||
      b?.id === myId ||
      w?.id === myId);
  const hasOpenSlot = !opponent.value && !(b && w);
  const challengee = opponent.value ?? (b?.id !== props.creator_id ? b : w);
  const isReview = stage === GameStage.TerritoryReview;
  const inEstimate = phase.phase === "estimate";
  const inPresentation = phase.phase === "presentation";
  const onFinalized = boardFinalized.value;
  const boardNav = navState.value;

  const opponentApproved =
    isReview && isPlayer
      ? stone === 1
        ? !!terr?.white_approved
        : !!terr?.black_approved
      : false;

  let territoryCountdownSecs: number | undefined;

  if (isReview && terr?.expires_at) {
    const remaining = new Date(terr.expires_at).getTime() - uiNowMs.value;
    territoryCountdownSecs = Math.ceil(Math.max(0, remaining) / 1000);
  }

  const statusStage =
    onFinalized && res
      ? res === "Aborted"
        ? GameStage.Aborted
        : res === "Declined"
          ? GameStage.Declined
          : GameStage.Completed
      : stage;

  const statusResult =
    statusStage === GameStage.Completed ||
    statusStage === GameStage.Aborted ||
    statusStage === GameStage.Declined
      ? (res ?? undefined)
      : undefined;

  let disconnectCountdown: string | undefined;

  if (isPlayer && !isDone && !res && oppDisconnected) {
    if (oppDisconnected.gone) {
      disconnectCountdown = "Opponent left the game.";
    } else if (oppDisconnected.gracePeriodMs != null) {
      const elapsed = uiNowMs.value - oppDisconnected.since.getTime();
      const remaining = Math.max(
        0,
        Math.ceil((oppDisconnected.gracePeriodMs - elapsed) / 1000),
      );
      disconnectCountdown =
        remaining > 0
          ? `Opponent left. ${remaining}s to reconnect.`
          : "Opponent left the game.";
    } else {
      disconnectCountdown = "Opponent disconnected.";
    }
  }

  let lobbyPopover: LiveGameStatusState["lobbyPopover"];
  const hasValidAccessToken = !!props.has_valid_access_token;
  const isChallenge = stage === GameStage.Challenge;
  const isCreator = myId != null && myId === props.creator_id;
  const isChallengee =
    isChallenge && isParticipant && myId != null && myId !== props.creator_id;
  const opponentName =
    opponent.value?.display_name ??
    challengee?.display_name ??
    (b?.id === props.creator_id ? w?.display_name : b?.display_name);
  const canJoinGame = canJoinGameFromProps({
    isPlayer: isParticipant,
    hasOpenSlot,
    settings: props.settings,
    hasValidAccessToken,
    serverCanJoinGame: props.can_join_game,
  });

  if (isChallengee) {
    lobbyPopover = {
      variant: "challengee",
      title: "Waiting for your response",
    };
  } else if (isCreator && !isDone && !res && isChallenge) {
    lobbyPopover = {
      variant: "creator-challenge",
      title: `Waiting for ${opponentName ?? "opponent"}`,
    };
  } else if (isCreator && !isDone && !res && hasOpenSlot && !isChallenge) {
    lobbyPopover = {
      variant: "creator-waiting",
      title: "Waiting for opponent",
    };
  } else if (
    !isParticipant &&
    !isDone &&
    !res &&
    (isChallenge || hasOpenSlot) &&
    ((isChallenge && !requiresAccessTokenToJoin(props.settings)) ||
      ((!requiresAccessTokenToJoin(props.settings) || hasValidAccessToken) &&
        !requiresInviteTokenToJoin(props.settings)))
  ) {
    lobbyPopover = {
      variant: isChallenge ? "visitor-challenge" : "visitor-open",
      title: `Waiting for ${opponentName ?? "opponent"}`,
    };
  }

  const statusText =
    getStatusText({
      stage: statusStage,
      result: statusResult,
      komi: props.komi,
      estimateScore:
        inEstimate || onFinalized
          ? (estimateScore.value ??
            (onFinalized ? boardFinalizedScore.value : undefined))
          : undefined,
      territoryScore: terr?.score,
      lastMoveWasPass: boardNav.boardLastMoveWasPass,
      isChallengeCreator: myId != null && myId === props.creator_id,
      challengeWaitingFor: challengee?.display_name,
      hasOpenSlot,
      isBlackTurn: boardNav.boardTurnStone === 1,
      isPlayer,
      opponentApproved,
      territoryCountdownSecs,
    }) ?? "";

  let presentationStatusSuffix = "";

  if (inPresentation) {
    if (isPresenter.value) {
      presentationStatusSuffix = " (You are presenting)";
    } else if (presenterDisplayName.value) {
      presentationStatusSuffix = ` (${presenterDisplayName.value} presenting)`;
    }
  }

  return {
    canJoinGame,
    statusText,
    presentationStatusSuffix,
    disconnectCountdown,
    lobbyPopover,
    showInviteLink: !!props.access_token && isParticipant,
  };
});
