import type { PlayerPanelProps } from "../../components/player-panel";
import type { TerritoryOverlay } from "../../goban/create-board";

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
  canFinalizeTerritory: boolean;
  canToggleDeadStones: boolean;

  // Lobby / lifecycle
  canJoinGame: boolean;
  showInviteLink: boolean;
  lobbyPopover?: {
    variant:
      | "creator-waiting"
      | "creator-challenge"
      | "challengee"
      | "visitor-open"
      | "visitor-challenge";
    title: string;
  };
  canClaimVictory: boolean;
  disconnectCountdown?: string;
  canRematch: boolean;

  // Mode transitions
  canEnterAnalysis: boolean;
  showAnalysis: boolean;
  canExitAnalysis: boolean;
  canEnterEstimate: boolean;
  showEnterEstimate: boolean;
  estimateActive: boolean;
  canExitEstimate: boolean;
  canEnterPresentation: boolean;
  canExitPresentation: boolean;
  canReturnControl: boolean;

  // Navigation
  canNavigate: boolean;
  showMoveConfirmToggle: boolean;

  // Undo response
  showUndoResponse: boolean;

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

export type LiveGameControlsState = Pick<
  UiCapabilities,
  | "canPass"
  | "showPass"
  | "canRequestUndo"
  | "canResign"
  | "showResign"
  | "canAbort"
  | "canAcceptTerritory"
  | "canFinalizeTerritory"
  | "canClaimVictory"
  | "canRematch"
  | "canExitAnalysis"
  | "canEnterAnalysis"
  | "showAnalysis"
  | "canEnterEstimate"
  | "showEnterEstimate"
  | "estimateActive"
  | "canExitEstimate"
  | "canEnterPresentation"
  | "canExitPresentation"
  | "canReturnControl"
  | "showMoveConfirmToggle"
  | "showUndoResponse"
  | "undoTooltip"
  | "passIsAnalysisPass"
  | "confirmPassRequired"
  | "estimateTitle"
  | "exitEstimateTitle"
  | "showAnalyzeChoice"
  | "canTakeControl"
  | "canRequestControl"
  | "canCancelControlRequest"
  | "controlRequestPending"
  | "controlRequestDisplayName"
  | "controlRequestUserId"
  | "showControlRequestResponse"
  | "nav"
>;

export type LiveGamePanelState = Pick<
  UiCapabilities,
  "topPanel" | "bottomPanel"
>;

export type LiveGameStatusState = Pick<
  UiCapabilities,
  | "canJoinGame"
  | "statusText"
  | "presentationStatusSuffix"
  | "disconnectCountdown"
  | "lobbyPopover"
  | "showInviteLink"
>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

export type { PanelScoreFields, ScoreInput };

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
  showEstimate: boolean;
  canPlayMove: boolean;
  showTerritoryReady: boolean;
  showTerritoryExit: boolean;
  showSgfImport: boolean;
  showSgfExport: boolean;
  statusText: string;
};
