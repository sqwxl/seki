import { computed } from "@preact/signals";
import type { PlayerPanelProps } from "../components/player-panel";
import { getStatusText } from "../components/game-status";
import type { TerritoryOverlay } from "../goban/create-board";
import type { Point } from "../goban/types";
import { GameStage, isPlayStage } from "./types";
import type { TerritoryData, SettledTerritoryData, UserData } from "./types";
import { clockDisplay } from "./clock";
import { gamePhase } from "./phase";
import type { GamePhase } from "./phase";
import { analysisTerritoryInfo } from "../layouts/analysis-state";
import {
  gameState,
  gameStage,
  currentTurn,
  moves,
  black,
  white,
  result,
  territory,
  settledTerritory,
  onlineUsers,
  undoRejected,
  allowUndo,
  playerStone,
  initialProps,
  nigiri,
  opponentDisconnected,
  estimateScore,
  showMoveTree,
  moveConfirmEnabled,
  navState,
  hasUnreadChat,
  isPresenter,
  isOriginator,
  currentUserId,
  controlRequest,
  presenterDisplayName,
} from "./state";

// ---------------------------------------------------------------------------
// UiCapabilities type
// ---------------------------------------------------------------------------

export type UiCapabilities = {
  // Game actions — "can" = fully enabled, "show" = visible (possibly disabled)
  canPass: boolean;
  showPass: boolean;
  canRequestUndo: boolean;
  canResign: boolean;
  showResign: boolean;
  canAbort: boolean;
  canAcceptTerritory: boolean;
  canToggleDeadStones: boolean;

  // Lobby / lifecycle
  canJoinGame: boolean;
  showInviteLink: boolean;
  showChallengePopover: boolean;
  canClaimVictory: boolean;
  disconnectCountdown?: string;
  canRematch: boolean;

  // Mode transitions
  canEnterAnalysis: boolean;
  canExitAnalysis: boolean;
  canEnterEstimate: boolean;
  canExitEstimate: boolean;
  canEnterPresentation: boolean;
  canExitPresentation: boolean;
  canReturnControl: boolean;

  // Navigation
  canNavigate: boolean;
  showMoveConfirmToggle: boolean;

  // Contextual metadata
  undoTooltip: string;
  passIsAnalysisPass: boolean;
  confirmPassRequired: boolean;
  estimateTitle: string | undefined;
  exitEstimateTitle: string | undefined;

  // Presentation-specific
  showAnalyzeChoice: boolean;
  canTakeControl: boolean;
  canRequestControl: boolean;
  canCancelControlRequest: boolean;
  controlRequestPending: boolean;
  controlRequestDisplayName: string;
  controlRequestUserId: number | undefined;
  showControlRequestResponse: boolean;

  // Player panels
  topPanel: PlayerPanelProps;
  bottomPanel: PlayerPanelProps;

  // Board
  canPlayMove: boolean;
  showGhostStone: boolean;
  territoryOverlay: TerritoryOverlay | undefined;
  boardAspectRatio: string;

  // Status bar
  statusText: string;
  presentationStatusSuffix: string;

  // Move tree
  showMoveTree: boolean;

  // Chat
  showChat: boolean;
  hasUnreadChat: boolean;

  // Navigation state
  nav: {
    atStart: boolean;
    atLatest: boolean;
    atMainEnd: boolean;
    counter: string;
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function buildTerritoryOverlay(data: {
  ownership: number[];
  dead_stones: [number, number][];
}): TerritoryOverlay {
  const paintMap = data.ownership.map((v) => (v === 0 ? null : v));
  const dimmedVertices: Point[] = data.dead_stones.map(
    ([c, r]) => [c, r] as Point,
  );
  return { paintMap, dimmedVertices };
}

function deriveTerritoryOverlay(
  phase: GamePhase,
  stage: GameStage,
  terr: TerritoryData | undefined,
  settled: SettledTerritoryData | undefined,
): TerritoryOverlay | undefined {
  if (stage === GameStage.TerritoryReview && terr) {
    return buildTerritoryOverlay(terr);
  }
  // Settled territory overlay for estimate mode on finished games (not in analysis — WASM handles that)
  if (phase.phase === "estimate" && !phase.fromAnalysis && settled) {
    return buildTerritoryOverlay(settled);
  }
  return undefined;
}

type ScoreInput = {
  komi: number;
  captures: { black: number; white: number };
  score:
    | {
        black: { territory: number; captures: number };
        white: { territory: number; captures: number };
      }
    | undefined;
};

type PanelScoreFields = Pick<
  PlayerPanelProps,
  "captures" | "komi" | "territory"
>;

export function buildPlayerPanels(input: ScoreInput): {
  black: PanelScoreFields;
  white: PanelScoreFields;
} {
  const { komi, captures, score } = input;
  return {
    black: {
      captures: score ? score.black.captures : captures.black,
      komi: komi < 0 ? -komi : undefined,
      territory: score?.black.territory,
    },
    white: {
      captures: score ? score.white.captures : captures.white,
      komi: komi > 0 ? komi : undefined,
      territory: score?.white.territory,
    },
  };
}

export function derivePlayerPanel(opts: {
  position: "top" | "bottom";
  stone: number;
  blackUser: UserData | undefined;
  whiteUser: UserData | undefined;
  online: Map<number, UserData>;
  komi: number;
  captures: { black: number; white: number };
  score: ScoreInput["score"];
  cd: {
    blackText: string;
    whiteText: string;
    blackLow: boolean;
    whiteLow: boolean;
  };
  isNigiriPending: boolean;
}): PlayerPanelProps {
  const {
    position,
    stone,
    blackUser,
    whiteUser,
    online,
    komi,
    captures,
    score,
    cd,
    isNigiriPending,
  } = opts;
  const bName = blackUser ? blackUser.display_name : "...";
  const wName = whiteUser ? whiteUser.display_name : "...";
  const bUrl = blackUser ? `/users/${blackUser.display_name}` : undefined;
  const wUrl = whiteUser ? `/users/${whiteUser.display_name}` : undefined;
  const bOnline = blackUser ? online.has(blackUser.id) : false;
  const wOnline = whiteUser ? online.has(whiteUser.id) : false;

  const panels = buildPlayerPanels({ komi, captures, score });

  const blackPanel: PlayerPanelProps = {
    ...panels.black,
    name: bName,
    stone: isNigiriPending ? "nigiri" : "black",
    clock: cd.blackText || undefined,
    clockLowTime: cd.blackLow,
    profileUrl: bUrl,
    isOnline: bOnline,
  };
  const whitePanel: PlayerPanelProps = {
    ...panels.white,
    name: wName,
    stone: isNigiriPending ? "nigiri" : "white",
    clock: cd.whiteText || undefined,
    clockLowTime: cd.whiteLow,
    profileUrl: wUrl,
    isOnline: wOnline,
  };

  const isWhitePlayer = stone === -1;
  if (position === "top") {
    return isWhitePlayer ? blackPanel : whitePanel;
  }
  return isWhitePlayer ? whitePanel : blackPanel;
}

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
  const inPresentation = phase.phase === "presentation";
  const isSyncedViewer =
    phase.phase === "presentation" && phase.role === "synced-viewer";
  const modeActive = inAnalysis || inEstimate;

  // --- Game actions ---

  const canPass = isPlayer && isPlay && isMyTurn && !inEstimate && !inAnalysis;
  const passIsAnalysisPass = inAnalysis && !inEstimate;
  const showPass =
    (isPlayer && (isPlay || isChallenge) && !inEstimate) || passIsAnalysisPass;
  const confirmPassRequired = canPass && !inAnalysis;

  // Undo
  const canRequestUndo =
    isPlayer &&
    allowUndo.value &&
    isPlay &&
    !isChallenge &&
    mvs.length > 0 &&
    !isMyTurn &&
    !undoRejected.value &&
    !modeActive;

  let undoTooltip = "";
  if (isPlayer && allowUndo.value && (isPlay || isChallenge)) {
    if (isChallenge) {
      undoTooltip = "Challenge not yet accepted";
    } else if (undoRejected.value) {
      undoTooltip = "Undo was rejected for this move";
    } else if (mvs.length === 0) {
      undoTooltip = "No moves to undo";
    } else if (isMyTurn) {
      undoTooltip = "Cannot undo on your turn";
    } else {
      undoTooltip = "Request to undo your last move";
    }
  }

  const canResign = isPlayer && isPlay && !isChallenge && mvs.length > 0;
  const showResign = isPlayer && (isPlay || isChallenge);

  // Abort: player + no moves + not done + (not challenge OR is creator)
  const myId = stone === 1 ? b?.id : w?.id;
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
  const canToggleDeadStones = isReview && isPlayer;

  // --- Lobby / lifecycle ---

  const canJoinGame =
    !isPlayer &&
    hasOpenSlot &&
    !props.settings.is_private &&
    !props.settings.invite_only;

  const showInviteLink = !!props.invite_token && hasOpenSlot && isPlayer;

  const isChallengee =
    isChallenge && isPlayer && myId != null && myId !== props.creator_id;
  const showChallengePopover = isChallengee;

  const canClaimVictory =
    isPlayer && !isDone && !res && !!oppDisconnected?.gone;

  let disconnectCountdown: string | undefined;
  if (isPlayer && !isDone && !res && oppDisconnected) {
    if (oppDisconnected.gone) {
      disconnectCountdown = "Opponent left the game.";
    } else if (oppDisconnected.gracePeriodMs != null) {
      const elapsed = Date.now() - oppDisconnected.since.getTime();
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

  const canExitAnalysis = inAnalysis && !inEstimate;

  const canEnterEstimate =
    !inEstimate && !isReview && (isPlay || (isDone && !!settled));
  const estimateTitle = isDone && !!settled ? "Show territory" : undefined;

  const canExitEstimate = inEstimate;
  const exitEstimateTitle = inAnalysis ? "Back to analysis" : undefined;

  const canEnterPresentation = isDone && !inPresentation;

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
  const score = estimateScore.value ?? terr?.score ?? settled?.score;

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

  const lastMove = mvs[mvs.length - 1];
  const challengee = b?.id !== props.creator_id ? b : w;

  const statusText =
    getStatusText({
      stage,
      result: res ?? undefined,
      komi: props.komi,
      estimateScore: inEstimate ? estimateScore.value : undefined,
      territoryScore: terr?.score,
      lastMoveWasPass: lastMove?.kind === "pass",
      isChallengeCreator: myId != null && myId === props.creator_id,
      challengeWaitingFor: challengee?.display_name,
      hasOpenSlot,
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
    canToggleDeadStones,

    canJoinGame,
    showInviteLink,
    showChallengePopover,
    canClaimVictory,
    disconnectCountdown,
    canRematch,

    canEnterAnalysis,
    canExitAnalysis,
    canEnterEstimate,
    canExitEstimate,
    canEnterPresentation,
    canExitPresentation,
    canReturnControl,

    canNavigate,
    showMoveConfirmToggle,

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

// ---------------------------------------------------------------------------
// Analysis capabilities (minimal — engine-derived state stays in the page)
// ---------------------------------------------------------------------------

/**
 * Capabilities for the standalone analysis page.
 * Only derives control-related booleans from `analysisTerritoryInfo` signal.
 * Engine-dependent state (panels, nav, status, clock) stays in the page
 * component because the WASM engine mutates in place — a computed signal
 * can't react to those changes.
 */
export type AnalysisCapabilities = {
  canPass: boolean;
  canEstimate: boolean;
  canPlayMove: boolean;
  showTerritoryReady: boolean;
  showTerritoryExit: boolean;
  showSgfImport: boolean;
  showSgfExport: boolean;
};

export const analysisCapabilities = computed((): AnalysisCapabilities => {
  const { reviewing, finalized } = analysisTerritoryInfo.value;
  const canPlay = !reviewing && !finalized;

  return {
    canPass: canPlay,
    canEstimate: canPlay,
    canPlayMove: canPlay,
    showTerritoryReady: reviewing,
    showTerritoryExit: reviewing,
    showSgfImport: canPlay,
    showSgfExport: canPlay,
  };
});
