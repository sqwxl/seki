import type { ControlsProps } from "../../components/controls-shared";
import type { LiveGameControlsState } from "../../game/capabilities";
import { buildTerritoryOverlay } from "../../game/capabilities";
import type { GameChannel } from "../../game/channel";
import { playStoneSound } from "../../game/sound";
import {
  analysisMode,
  board,
  clearGameFlashMessage,
  clearPendingAction,
  estimateMode,
  gameId,
  gameStage,
  initialProps,
  isPendingAction,
  pendingMove,
  setGameFlashMessage,
  setPendingAction,
  settledTerritory,
  territory,
} from "../../game/state";
import { GameStage } from "../../game/types";
import type { NavAction, TerritoryOverlay } from "../../goban/create-board";
import { requestSpaNavigation } from "../../utils/spa-navigation";
import { postForm } from "../../utils/web-client";

export function buildShareGameUrl(): string {
  const accessToken = initialProps.value.access_token;

  return initialProps.value.settings.is_private && accessToken
    ? `${window.location.origin}/games/${gameId.value}?access_token=${accessToken}`
    : `${window.location.origin}/games/${gameId.value}`;
}

export function getServerTerritory(): TerritoryOverlay | undefined {
  if (gameStage.value === GameStage.TerritoryReview && territory.value) {
    return buildTerritoryOverlay(territory.value);
  }

  if (estimateMode.value && settledTerritory.value) {
    return buildTerritoryOverlay(settledTerritory.value);
  }

  return undefined;
}

export function buildControls(
  caps: LiveGameControlsState,
  channel: GameChannel,
  mc: {
    get enabled(): boolean;
    get value(): [number, number] | undefined;
    clear(): void;
  },
  callbacks: {
    enterAnalysis: () => void;
    exitAnalysis: () => void;
    enterEstimate: () => void;
    exitEstimate: () => void;
    handleSgfExport: () => void;
    enterPresentation: () => void;
    exitPresentation: () => void;
    returnControl: () => void;
  },
): ControlsProps {
  const {
    enterAnalysis,
    exitAnalysis,
    enterEstimate,
    exitEstimate,
    handleSgfExport,
    enterPresentation,
    exitPresentation,
    returnControl,
  } = callbacks;

  const pendingUndoRequest = isPendingAction("request-undo");
  const pendingUndoAccept = isPendingAction("respond-undo-accept");
  const pendingUndoReject = isPendingAction("respond-undo-reject");
  const pendingPass = isPendingAction("pass");
  const pendingResign = isPendingAction("resign");
  const pendingAbort = isPendingAction("abort");
  const pendingClaimVictory = isPendingAction("claim-victory");
  const pendingTerritory = isPendingAction("accept-territory");
  const pendingAcceptChallenge = isPendingAction("accept-challenge");
  const pendingDeclineChallenge = isPendingAction("decline-challenge");
  const pendingJoinGame = isPendingAction("join-game");
  const pendingStartPresentation = isPendingAction("start-presentation");
  const pendingEndPresentation = isPendingAction("end-presentation");
  const pendingGiveControl = isPendingAction("give-control");
  const pendingTakeControl = isPendingAction("take-control");
  const pendingRequestControl = isPendingAction("request-control");
  const pendingCancelControlRequest = isPendingAction("cancel-control-request");
  const pendingRejectControlRequest = isPendingAction("reject-control-request");
  const pendingRematch = isPendingAction("rematch");

  function runPendingAction(
    action: Parameters<typeof setPendingAction>[0],
    run: () => void,
  ) {
    clearGameFlashMessage();

    if (!setPendingAction(action)) {
      return;
    }

    run();
  }

  const controlsProps: ControlsProps = {
    nav: {
      ...caps.nav,
      onNavigate: (action: NavAction) => board.value?.navigate(action),
    },
  };

  // --- Pass ---
  if (caps.showPass) {
    if (caps.passIsAnalysisPass) {
      controlsProps.pass = { onClick: () => board.value?.pass() };
    } else {
      controlsProps.pass = { onClick: () => {}, disabled: !caps.canPass };

      if (caps.confirmPassRequired) {
        controlsProps.confirmPass = {
          message: "Pass your turn?",
          onConfirm: () => runPendingAction("pass", () => channel.pass()),
          pending: pendingPass ? "confirm" : undefined,
        };
      }
    }
  }

  // --- Undo ---
  if (caps.undoTooltip) {
    controlsProps.requestUndo = {
      onClick: () =>
        runPendingAction("request-undo", () => channel.requestUndo()),
      disabled: !caps.canRequestUndo,
      pending: pendingUndoRequest,
      title: caps.undoTooltip,
    };
  }

  // --- Undo response ---
  if (caps.showUndoResponse) {
    controlsProps.undoResponse = {
      onAccept: () => {
        runPendingAction("respond-undo-accept", () => channel.acceptUndo());
      },
      onReject: () => {
        runPendingAction("respond-undo-reject", () => channel.rejectUndo());
      },
      pending: pendingUndoAccept
        ? "confirm"
        : pendingUndoReject
          ? "cancel"
          : undefined,
    };
  }

  // --- Resign ---
  if (caps.showResign) {
    controlsProps.resign = {
      message: "Resign this game?",
      onConfirm: () => runPendingAction("resign", () => channel.resign()),
      disabled: !caps.canResign,
      pending: pendingResign ? "confirm" : undefined,
    };
  }

  // --- Abort ---
  if (caps.canAbort) {
    controlsProps.abort = {
      message: "Abort this game?",
      onConfirm: () => runPendingAction("abort", () => channel.abort()),
      pending: pendingAbort ? "confirm" : undefined,
    };
  }

  // --- Territory accept ---
  if (caps.canAcceptTerritory) {
    controlsProps.acceptTerritory = {
      onClick: () =>
        runPendingAction("accept-territory", () => channel.approveTerritory()),
      pending: pendingTerritory,
    };
  } else if (caps.canFinalizeTerritory) {
    controlsProps.acceptTerritory = {
      onClick: () => board.value?.finalizeTerritoryReview(),
    };
  }

  // --- Claim victory (opponent left) ---
  if (caps.canClaimVictory) {
    controlsProps.claimVictory = {
      message: "Claim victory? (Opponent left the game)",
      onConfirm: () =>
        runPendingAction("claim-victory", () => channel.claimVictory()),
      pending: pendingClaimVictory ? "confirm" : undefined,
    };
  }

  // --- Rematch ---
  if (caps.canRematch) {
    controlsProps.rematch = {
      onConfirm: async (swapColors) => {
        clearGameFlashMessage();

        if (!setPendingAction("rematch")) {
          return;
        }

        const formData = new FormData();
        formData.set("swap_colors", swapColors ? "true" : "false");

        try {
          const result = await postForm(
            `/games/${gameId.value}/rematch`,
            formData,
          );

          if (typeof result.redirect === "string") {
            requestSpaNavigation(result.redirect);
          }
        } catch (err) {
          clearPendingAction("rematch");
          setGameFlashMessage((err as { message: string }).message);
        }
      },
      pending: pendingRematch ? "confirm" : undefined,
      isRanked: initialProps.value.settings.ranked,
    };
  }

  // --- Analysis / Presentation toggle (single button) ---
  if (caps.canReturnControl) {
    controlsProps.analyze = {
      onClick: () => runPendingAction("give-control", returnControl),
      active: true,
      pending: pendingGiveControl,
    };
  } else if (caps.canExitPresentation) {
    controlsProps.analyze = {
      onClick: () => runPendingAction("end-presentation", exitPresentation),
      active: true,
      pending: pendingEndPresentation,
    };
  } else if (caps.canExitAnalysis) {
    controlsProps.analyze = {
      onClick: exitAnalysis,
      disabled: caps.canExitEstimate,
      active: true,
    };
  } else if (caps.showAnalyzeChoice) {
    const options: Array<{
      label: string;
      onClick: () => void;
      disabled?: boolean;
      pending?: boolean;
    }> = [];

    if (caps.canTakeControl) {
      options.push({
        label: "Take control",
        onClick: () =>
          runPendingAction("take-control", () => channel.takeControl()),
        pending: pendingTakeControl,
        disabled:
          pendingRequestControl ||
          pendingCancelControlRequest ||
          pendingTakeControl,
      });
    } else if (caps.canCancelControlRequest) {
      options.push({
        label: "Cancel request",
        onClick: () =>
          runPendingAction("cancel-control-request", () =>
            channel.cancelControlRequest(),
          ),
        pending: pendingCancelControlRequest,
        disabled: pendingCancelControlRequest,
      });
    } else if (caps.controlRequestPending) {
      options.push({
        label: `${caps.controlRequestDisplayName} request pending`,
        onClick: () => {},
        disabled: true,
      });
    } else if (caps.canRequestControl) {
      options.push({
        label: "Request control",
        onClick: () =>
          runPendingAction("request-control", () => channel.requestControl()),
        pending: pendingRequestControl,
        disabled: pendingRequestControl,
      });
    }

    options.push({
      label: "Analyze (local)",
      onClick: enterAnalysis,
    });

    controlsProps.analyzeChoice = { options };
    controlsProps.analyze = { onClick: () => {} };
  } else if (caps.canEnterPresentation) {
    controlsProps.analyze = {
      onClick: () => runPendingAction("start-presentation", enterPresentation),
      pending: pendingStartPresentation,
    };
  } else if (caps.showAnalysis) {
    controlsProps.analyze = {
      onClick: enterAnalysis,
      disabled: !caps.canEnterAnalysis,
    };
  }

  // --- Estimate ---
  if (caps.canExitEstimate) {
    controlsProps.exitEstimate = {
      onClick: exitEstimate,
      title: caps.exitEstimateTitle,
    };
  } else if (caps.showEnterEstimate) {
    controlsProps.estimate = {
      onClick: enterEstimate,
      title: caps.estimateTitle,
      disabled: !caps.canEnterEstimate,
    };
  }

  // --- SGF export ---
  controlsProps.sgfExport = {
    onClick: handleSgfExport,
    disabled: caps.canExitEstimate,
  };

  // --- Control request response ---
  if (caps.showControlRequestResponse && caps.controlRequestUserId != null) {
    controlsProps.controlRequestResponse = {
      displayName: caps.controlRequestDisplayName,
      onGive: () =>
        runPendingAction("give-control", () =>
          channel.giveControl(caps.controlRequestUserId!),
        ),
      onDismiss: () =>
        runPendingAction("reject-control-request", () =>
          channel.rejectControlRequest(),
        ),
      pending: pendingGiveControl
        ? "confirm"
        : pendingRejectControlRequest
          ? "cancel"
          : undefined,
    };
  }

  // --- Confirm move (ephemeral — read from mc state) ---
  if (pendingMove.value) {
    if (analysisMode.value) {
      controlsProps.confirmMove = {
        onClick: () => {
          if (pendingMove.value && board.value) {
            const [col, row] = pendingMove.value;
            mc.clear();
            pendingMove.value = undefined;

            const oldTreeNodeCount = board.value.engine.tree_node_count();

            if (board.value.engine.try_play(col, row)) {
              if (board.value.engine.tree_node_count() > oldTreeNodeCount) {
                playStoneSound();
              }
              board.value.save();
              board.value.render();
            }
          }
        },
      };
    } else {
      controlsProps.confirmMove = {
        onClick: () => {
          if (pendingMove.value) {
            const [col, row] = pendingMove.value;
            mc.clear();
            pendingMove.value = undefined;
            channel.play(col, row);
          }
        },
      };
    }
  }

  return controlsProps;
}
