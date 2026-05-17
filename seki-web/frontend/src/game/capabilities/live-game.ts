import { computed } from "@preact/signals";
import { getStatusText } from "../../components/game-status";
import {
  requiresAccessTokenToJoin,
  requiresInviteTokenToJoin,
} from "../access";
import { clockDisplay } from "../clock";
import { gamePhase } from "../phase";
import {
  allowUndo,
  black,
  boardFinalized,
  boardFinalizedScore,
  boardReviewing,
  canStartPresentation,
  controlRequest,
  currentTurn,
  currentUserId,
  estimateScore,
  gameStage,
  gameState,
  hasUnreadChat,
  initialProps,
  isOriginator,
  isPresenter,
  moveConfirmEnabled,
  moves,
  navState,
  nigiri,
  onlineUsers,
  opponentDisconnected,
  playerStone,
  presenterDisplayName,
  result,
  settledTerritory,
  showMoveTree,
  territory,
  uiNowMs,
  undoRequest,
  white,
} from "../state";
import { GameStage, isPlayStage } from "../types";
import { deriveTerritoryOverlay } from "./build-overlay";
import { derivePlayerPanel } from "./build-panels";
import type { UiCapabilities } from "./types";

// ---------------------------------------------------------------------------
// Computed signal
// ---------------------------------------------------------------------------

export const liveGameCapabilities = computed((): UiCapabilities => {
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
  const b = black.value;
  const w = white.value;
  const terr = territory.value;
  const settled = settledTerritory.value;
  const online = onlineUsers.value;
  const cd = clockDisplay.value;
  const oppDisconnected = opponentDisconnected.value;
  const hasOpenSlot = !b || !w;

  // Phase-derived booleans
  // "inAnalysis" means the user is in an analysis-capable mode (analysis, presenter, or local-analysis)
  const inAnalysis =
    phase.phase === "analysis" ||
    (phase.phase === "presentation" &&
      (phase.role === "presenter" || phase.role === "local-analysis"));
  const inEstimate = phase.phase === "estimate";
  const estimateFromAnalysis = phase.phase === "estimate" && phase.fromAnalysis;
  const inPresentation = phase.phase === "presentation";
  const isSyncedViewer =
    phase.phase === "presentation" && phase.role === "synced-viewer";
  const modeActive = inAnalysis || inEstimate;

  // --- Game actions ---

  const canPass = isPlayer && isPlay && isMyTurn && !inEstimate && !inAnalysis;
  const passIsAnalysisPass = inAnalysis && !inEstimate;
  const showPass =
    (isPlayer && (isPlay || isChallenge) && !estimateFromAnalysis) ||
    passIsAnalysisPass;
  const confirmPassRequired = canPass && !inAnalysis;

  // Undo
  const undoState = undoRequest.value;
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

  const showUndoResponse = undoState === "received";

  const canResign =
    isPlayer && isPlay && !isChallenge && mvs.length > 0 && !modeActive;
  const showResign = isPlayer && (isPlay || isChallenge);

  // Abort: player + no moves + not done + (not challenge OR is creator)
  const myId = currentUserId.value || undefined;
  const isCreator = myId != null && myId === props.creator_id;
  const canAbort =
    isPlayer &&
    mvs.length === 0 &&
    !isDone &&
    !res &&
    (!isChallenge || isCreator);

  // Territory
  const canAcceptTerritory =
    isReview &&
    isPlayer &&
    !oppDisconnected &&
    !(
      (stone === 1 && terr?.black_approved) ||
      (stone === -1 && terr?.white_approved)
    );
  const canFinalizeTerritory = inEstimate && boardReviewing.value;
  const canToggleDeadStones = isReview && isPlayer;

  // --- Lobby / lifecycle ---

  const canJoinGame =
    !isPlayer &&
    hasOpenSlot &&
    (!requiresAccessTokenToJoin(props.settings) ||
      !!props.has_valid_access_token) &&
    !requiresInviteTokenToJoin(props.settings);

  const showInviteLink = !!props.access_token && isPlayer;

  const isChallengee =
    isChallenge && isPlayer && myId != null && myId !== props.creator_id;

  const opponentName =
    b?.id === props.creator_id ? w?.display_name : b?.display_name;

  let lobbyPopover: UiCapabilities["lobbyPopover"];
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
    !isPlayer &&
    !isDone &&
    !res &&
    (isChallenge || hasOpenSlot) &&
    ((isChallenge && !requiresAccessTokenToJoin(props.settings)) ||
      canJoinGame ||
      !!props.has_valid_access_token)
  ) {
    lobbyPopover = {
      variant: isChallenge ? "visitor-challenge" : "visitor-open",
      title: `Waiting for ${opponentName ?? "opponent"}`,
    };
  }

  const canClaimVictory =
    isPlayer && !isDone && !res && !!oppDisconnected?.gone;

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
      if (remaining > 0) {
        disconnectCountdown = `Opponent left. ${remaining}s to reconnect.`;
      } else {
        disconnectCountdown = "Opponent left the game.";
      }
    } else {
      disconnectCountdown = "Opponent disconnected.";
    }
  }

  const canRematch = !!res && isDone && isPlayer;

  // --- Mode transitions ---

  const canEnterAnalysis =
    !inAnalysis && !inEstimate && !isReview && !inPresentation;
  // Keep the analysis button visible (but disabled) during estimate-from-live to prevent layout shift
  const showAnalysis =
    canEnterAnalysis || (inEstimate && !estimateFromAnalysis);

  const canExitAnalysis = inAnalysis || estimateFromAnalysis;

  const onFinalized = boardFinalized.value;
  const showEnterEstimate =
    !inEstimate && !isReview && (isPlay || (isDone && !!settled));
  const canEnterEstimate = showEnterEstimate && !onFinalized;
  const estimateTitle = isDone && !!settled ? "Show territory" : undefined;

  const canExitEstimate = inEstimate;
  const exitEstimateTitle = inAnalysis ? "Back to analysis" : undefined;

  const canEnterPresentation =
    isDone && !inPresentation && canStartPresentation.value;

  // Originator-presenter can end the presentation; local-analysis viewers
  // exit via canExitAnalysis instead (their exitAnalysis re-syncs with the stream).
  const canExitPresentation =
    inPresentation && isPresenter.value && isOriginator.value;

  // Non-originator presenter returns control instead of ending presentation.
  const canReturnControl =
    inPresentation && isPresenter.value && !isOriginator.value;

  // --- Navigation ---

  const canNavigate = !isSyncedViewer;

  const showMoveConfirmToggle = isPlayer && isPlay;

  // --- Presentation-specific ---

  // showAnalyzeChoice: viewer in presentation, not in local-analysis
  const showAnalyzeChoice = inPresentation && !isPresenter.value && !inAnalysis;

  const canTakeControl =
    inPresentation && isOriginator.value && !isPresenter.value;

  const myControlRequest = controlRequest.value?.userId === currentUserId.value;
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

  // --- Player panels ---

  const isNigiriPending = nigiri.value && !isPlay && !isReview && !res;
  const score =
    estimateScore.value ??
    terr?.score ??
    (onFinalized ? (boardFinalizedScore.value ?? settled?.score) : undefined);

  const panelOpts = {
    stone,
    blackUser: b,
    whiteUser: w,
    online,
    komi: props.komi,
    captures: gameState.value.captures,
    score,
    cd,
    isNigiriPending,
  };

  const topPanel = derivePlayerPanel({ ...panelOpts, position: "top" });
  const bottomPanel = derivePlayerPanel({ ...panelOpts, position: "bottom" });

  // --- Board ---

  const canPlayMove =
    inAnalysis || (isPlayer && !isDone && !isChallenge && isMyTurn);

  const showGhostStone = !inAnalysis && !inEstimate && moveConfirmEnabled.value;

  const territoryOverlay = deriveTerritoryOverlay(phase, stage, terr, settled);

  const boardAspectRatio = `${gameState.value.cols}/${gameState.value.rows}`;

  // --- Status text ---

  const challengee = b?.id !== props.creator_id ? b : w;
  const boardNav = navState.value;

  // Territory review: opponent approval + countdown
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

  // --- Nav state ---

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
    canToggleDeadStones,

    canJoinGame,
    showInviteLink,
    lobbyPopover,
    canClaimVictory,
    disconnectCountdown,
    canRematch,

    canEnterAnalysis,
    showAnalysis,
    canExitAnalysis,
    canEnterEstimate,
    showEnterEstimate,
    canExitEstimate,
    canEnterPresentation,
    canExitPresentation,
    canReturnControl,

    canNavigate,
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

    topPanel,
    bottomPanel,

    canPlayMove,
    showGhostStone,
    territoryOverlay,
    boardAspectRatio,

    statusText,
    presentationStatusSuffix,

    showMoveTree: showMoveTree.value || inAnalysis,

    showChat: true,
    hasUnreadChat: hasUnreadChat.value,

    nav,
  };
});
