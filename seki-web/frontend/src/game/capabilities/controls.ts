import { computed } from "@preact/signals";
import { gamePhase } from "../phase";
import {
  allowUndo,
  boardFinalized,
  boardReviewing,
  canStartPresentation,
  controlRequest,
  currentTurn,
  currentUserId,
  gameStage,
  initialProps,
  isOriginator,
  isPresenter,
  moves,
  navState,
  opponent,
  opponentDisconnected,
  playerStone,
  result,
  settledTerritory,
  territory,
  undoRequest,
} from "../state";
import { GameStage, isPlayStage } from "../types";
import { isAnalysisCapablePhase } from "./build-overlay";
import type { LiveGameControlsState } from "./types";

export const liveGameControlsState = computed((): LiveGameControlsState => {
  const phase = gamePhase.value;
  const stage = gameStage.value;
  const stone = playerStone.value;
  const isPlayer = stone !== 0;
  const isChallenge = stage === GameStage.Challenge;
  const isPlay = isPlayStage(stage);
  const isReview = stage === GameStage.TerritoryReview;
  const isDone =
    stage === GameStage.Completed ||
    stage === GameStage.Aborted ||
    stage === GameStage.Declined;
  const isMyTurn = isPlayer && currentTurn.value === stone && isPlay;
  const mvs = moves.value;
  const res = result.value;
  const props = initialProps.value;
  const terr = territory.value;
  const settled = settledTerritory.value;
  const oppDisconnected = opponentDisconnected.value;
  const inAnalysis = isAnalysisCapablePhase(phase);
  const inEstimate = phase.phase === "estimate";
  const estimateFromAnalysis = phase.phase === "estimate" && phase.fromAnalysis;
  const inPresentation = phase.phase === "presentation";
  const isSyncedViewer =
    phase.phase === "presentation" && phase.role === "synced-viewer";
  const modeActive = inAnalysis || inEstimate;
  const undoState = undoRequest.value;
  const myId = currentUserId.value || undefined;
  const isCreator = myId != null && myId === props.creator_id;
  const isParticipant =
    isPlayer ||
    (myId != null &&
      (myId === props.creator_id || myId === opponent.value?.id));
  const onFinalized = boardFinalized.value;
  const myControlRequest = controlRequest.value?.userId === currentUserId.value;

  const canPass = isPlayer && isPlay && isMyTurn && !inEstimate && !inAnalysis;
  const passIsAnalysisPass = inAnalysis && !inEstimate;
  const showPass =
    (isPlayer && (isPlay || isChallenge) && !estimateFromAnalysis) ||
    passIsAnalysisPass;
  const confirmPassRequired = canPass && !inAnalysis;

  const canRequestUndo =
    isPlayer &&
    allowUndo.value &&
    isPlay &&
    !isChallenge &&
    mvs.length > 0 &&
    !isMyTurn &&
    undoState === "none" &&
    !modeActive;

  let undoTooltip = "";

  if (isPlayer && allowUndo.value && (isPlay || isChallenge)) {
    if (isChallenge) {
      undoTooltip = "Challenge not yet accepted";
    } else if (undoState === "rejected") {
      undoTooltip = "Undo was rejected for this move";
    } else if (undoState === "sent") {
      undoTooltip = "Undo request pending";
    } else if (mvs.length === 0) {
      undoTooltip = "No moves to undo";
    } else if (isMyTurn) {
      undoTooltip = "Cannot undo on your turn";
    } else {
      undoTooltip = "Request to undo your last move";
    }
  }

  const canResign =
    isPlayer && isPlay && !isChallenge && mvs.length > 0 && !modeActive;

  const showResign = isPlayer && (isPlay || isChallenge);

  const canAbort =
    isParticipant &&
    mvs.length === 0 &&
    !isDone &&
    !res &&
    (!isChallenge || isCreator);

  const canAcceptTerritory =
    isReview &&
    isPlayer &&
    !oppDisconnected &&
    !(
      (stone === 1 && terr?.black_approved) ||
      (stone === -1 && terr?.white_approved)
    );
  const canFinalizeTerritory = inEstimate && boardReviewing.value;
  const estimateActive = inEstimate && !boardReviewing.value;

  const canClaimVictory =
    isPlayer && !isDone && !res && !!oppDisconnected?.gone;

  const canRematch = !!res && isDone && isPlayer;

  const canEnterAnalysis =
    !inAnalysis && !inEstimate && !isReview && !inPresentation;

  const showAnalysis =
    canEnterAnalysis || (inEstimate && !estimateFromAnalysis);

  const canExitAnalysis = inAnalysis || estimateFromAnalysis;

  const canUseEstimate = isDone || !isPlayer;
  const showEnterEstimate =
    estimateActive ||
    (!inEstimate && !isReview && (isPlay || isDone) && canUseEstimate);

  const canEnterEstimate = showEnterEstimate && (!onFinalized || isDone);

  const estimateTitle = isDone ? "Show territory" : undefined;

  const canExitEstimate = inEstimate && boardReviewing.value;

  const exitEstimateTitle = inAnalysis ? "Back to analysis" : undefined;

  const canEnterPresentation =
    isDone && !inPresentation && canStartPresentation.value;

  const canExitPresentation =
    inPresentation && isPresenter.value && isOriginator.value;

  const canReturnControl =
    inPresentation && isPresenter.value && !isOriginator.value;

  const showMoveConfirmToggle = isPlayer && isPlay;
  const showUndoResponse = undoState === "received";
  const showAnalyzeChoice = inPresentation && !isPresenter.value && !inAnalysis;

  const canTakeControl =
    inPresentation && isOriginator.value && !isPresenter.value;

  const canRequestControl =
    inPresentation &&
    !isOriginator.value &&
    !isPresenter.value &&
    !myControlRequest &&
    !controlRequest.value;

  const canCancelControlRequest =
    inPresentation && !isPresenter.value && myControlRequest;

  const controlRequestPending =
    inPresentation &&
    !isPresenter.value &&
    !isOriginator.value &&
    !!controlRequest.value &&
    !myControlRequest;

  const controlRequestDisplayName = controlRequest.value?.displayName ?? "";
  const controlRequestUserId = controlRequest.value?.userId;

  const showControlRequestResponse =
    inPresentation && isOriginator.value && !!controlRequest.value;

  const ns = navState.value;
  const nav = isSyncedViewer
    ? { atStart: true, atLatest: true, atMainEnd: true, counter: ns.counter }
    : {
        atStart: ns.atStart,
        atLatest: ns.atLatest,
        atMainEnd: ns.atMainEnd,
        counter: ns.counter,
      };

  return {
    canPass,
    showPass,
    canRequestUndo,
    canResign,
    showResign,
    canAbort,
    canAcceptTerritory,
    canFinalizeTerritory,
    canClaimVictory,
    canRematch,
    canExitAnalysis,
    canEnterAnalysis,
    showAnalysis,
    canEnterEstimate,
    showEnterEstimate,
    estimateActive,
    canExitEstimate,
    canEnterPresentation,
    canExitPresentation,
    canReturnControl,
    showMoveConfirmToggle,
    showUndoResponse,
    undoTooltip,
    passIsAnalysisPass,
    confirmPassRequired,
    estimateTitle,
    exitEstimateTitle,
    showAnalyzeChoice,
    canTakeControl,
    canRequestControl,
    canCancelControlRequest,
    controlRequestPending,
    controlRequestDisplayName,
    controlRequestUserId,
    showControlRequestResponse,
    nav,
  };
});
