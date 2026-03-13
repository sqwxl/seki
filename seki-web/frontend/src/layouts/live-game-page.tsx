import type { Point } from "../goban/types";
import type { NavAction, TerritoryOverlay } from "../goban/create-board";
import { GameStage } from "../game/types";
import { Chat } from "../components/chat";
import { GameInfo } from "../components/game-info";
import { GameStatus } from "../components/game-status";
import type { ControlsProps } from "../components/controls";
import { LobbyControls, LobbyPopover } from "../components/controls";
import type { GameChannel } from "../game/channel";
import type { MoveConfirmState } from "../utils/move-confirm";
import { GamePageLayout } from "./game-page-layout";
import type { UiCapabilities } from "../game/capabilities";
import {
  liveGameCapabilities,
  buildTerritoryOverlay,
} from "../game/capabilities";
import {
  gameState,
  gameStage,
  moves,
  black,
  white,
  result,
  territory,
  settledTerritory,
  chatMessages,
  undoRequest,
  estimateMode,
  board,
  playerStone,
  initialProps,
  gameId,
  estimateScore,
  showMoveTree,
  nigiri,
  allowUndo,
  onlineUsers,
} from "../game/state";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LiveGamePageProps = {
  channel: GameChannel;
  mc: MoveConfirmState;
  moveTreeEl: HTMLElement;
  gobanRef: preact.Ref<HTMLDivElement>;
  enterAnalysis: () => void;
  exitAnalysis: () => void;
  enterEstimate: () => void;
  exitEstimate: () => void;
  handleSgfExport: () => void;
  enterPresentation: () => void;
  exitPresentation: () => void;
  returnControl: () => void;
};

// ---------------------------------------------------------------------------
// Territory overlay helpers (used by board callbacks, exported for mount)
// ---------------------------------------------------------------------------

export function getServerTerritory(): TerritoryOverlay | undefined {
  if (gameStage.value === GameStage.TerritoryReview && territory.value) {
    return buildTerritoryOverlay(territory.value);
  }
  // Settled territory overlay for finished games (not in analysis — WASM handles that)
  if (estimateMode.value && settledTerritory.value) {
    return buildTerritoryOverlay(settledTerritory.value);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Controls builder — maps capabilities + callbacks to ControlsProps
// ---------------------------------------------------------------------------

function buildControls(
  caps: UiCapabilities,
  props: LiveGamePageProps,
): ControlsProps {
  const { channel, mc } = props;

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
          onConfirm: () => channel.pass(),
        };
      }
    }
  }

  // --- Undo ---
  if (caps.undoTooltip) {
    controlsProps.requestUndo = {
      onClick: () => channel.requestUndo(),
      disabled: !caps.canRequestUndo,
      title: caps.undoTooltip,
    };
  }

  // --- Undo response ---
  if (caps.showUndoResponse) {
    controlsProps.undoResponse = {
      onAccept: () => {
        undoRequest.value = "none";
        channel.acceptUndo();
      },
      onReject: () => {
        undoRequest.value = "none";
        channel.rejectUndo();
      },
    };
  }

  // --- Resign ---
  if (caps.showResign) {
    controlsProps.resign = {
      message: "Resign this game?",
      onConfirm: () => channel.resign(),
      disabled: !caps.canResign,
    };
  }

  // --- Abort ---
  if (caps.canAbort) {
    controlsProps.abort = {
      message: "Abort this game?",
      onConfirm: () => channel.abort(),
    };
  }

  // --- Territory accept ---
  if (caps.canAcceptTerritory) {
    controlsProps.acceptTerritory = {
      onClick: () => channel.approveTerritory(),
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
      onConfirm: () => channel.claimVictory(),
    };
  }

  // --- Rematch ---
  if (caps.canRematch) {
    controlsProps.rematch = {
      onConfirm: (swapColors) => {
        const form = document.createElement("form");
        form.method = "POST";
        form.action = `/games/${gameId.value}/rematch`;
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = "swap_colors";
        input.value = swapColors ? "true" : "false";
        form.appendChild(input);
        document.body.appendChild(form);
        form.submit();
      },
    };
  }

  // --- Analysis / Presentation toggle (single button) ---
  if (caps.canReturnControl) {
    controlsProps.analyze = { onClick: props.returnControl, active: true };
  } else if (caps.canExitPresentation) {
    controlsProps.analyze = { onClick: props.exitPresentation, active: true };
  } else if (caps.canExitAnalysis) {
    controlsProps.analyze = {
      onClick: props.exitAnalysis,
      disabled: caps.canExitEstimate,
      active: true,
    };
  } else if (caps.showAnalyzeChoice) {
    const options: Array<{
      label: string;
      onClick: () => void;
      disabled?: boolean;
    }> = [];

    if (caps.canTakeControl) {
      options.push({
        label: "Take control",
        onClick: () => channel.takeControl(),
      });
    } else if (caps.canCancelControlRequest) {
      options.push({
        label: "Cancel request",
        onClick: () => channel.cancelControlRequest(),
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
        onClick: () => channel.requestControl(),
      });
    }
    options.push({
      label: "Analyze (local)",
      onClick: props.enterAnalysis,
    });

    controlsProps.analyzeChoice = { options };
    controlsProps.analyze = { onClick: () => {} };
  } else if (caps.canEnterPresentation) {
    controlsProps.analyze = { onClick: props.enterPresentation };
  } else if (caps.showAnalysis) {
    controlsProps.analyze = {
      onClick: props.enterAnalysis,
      disabled: !caps.canEnterAnalysis,
    };
  }

  // --- Estimate ---
  if (caps.canExitEstimate) {
    controlsProps.exitEstimate = {
      onClick: props.exitEstimate,
      title: caps.exitEstimateTitle,
    };
  } else if (caps.showEnterEstimate) {
    controlsProps.estimate = {
      onClick: props.enterEstimate,
      title: caps.estimateTitle,
      disabled: !caps.canEnterEstimate,
    };
  }

  // --- SGF export ---
  controlsProps.sgfExport = {
    onClick: props.handleSgfExport,
    disabled: caps.canExitEstimate,
  };

  // --- Control request response ---
  if (caps.showControlRequestResponse && caps.controlRequestUserId != null) {
    controlsProps.controlRequestResponse = {
      displayName: caps.controlRequestDisplayName,
      onGive: () => channel.giveControl(caps.controlRequestUserId!),
      onDismiss: () => channel.rejectControlRequest(),
    };
  }

  // --- Confirm move (ephemeral — read from mc state) ---
  if (mc.value) {
    controlsProps.confirmMove = {
      onClick: () => {
        if (mc.value) {
          const [col, row] = mc.value;
          mc.clear();
          channel.play(col, row);
        }
      },
    };
  }

  return controlsProps;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export function LiveGamePage(props: LiveGamePageProps) {
  const { channel, mc, moveTreeEl, gobanRef } = props;
  const caps = liveGameCapabilities.value;
  const controlsProps = buildControls(caps, props);

  const fullStatusText = caps.statusText + caps.presentationStatusSuffix;

  return (
    <GamePageLayout
      gobanRef={gobanRef}
      gobanStyle={`aspect-ratio: ${caps.boardAspectRatio}`}
      playerTop={caps.topPanel}
      playerBottom={caps.bottomPanel}
      controls={controlsProps}
      status={
        <>
          {fullStatusText && (
            <GameStatus text={fullStatusText}>
              <GameInfo
                settings={initialProps.value.settings}
                komi={initialProps.value.komi}
                stage={gameStage.value}
                moveCount={moves.value.length}
                result={result.value ?? undefined}
                black={black.value}
                white={white.value}
                capturesBlack={gameState.value.captures.black}
                capturesWhite={gameState.value.captures.white}
                territory={territory.value}
                settledTerritory={settledTerritory.value}
                estimateScore={
                  estimateMode.value ? estimateScore.value : undefined
                }
              />
            </GameStatus>
          )}
          <LobbyControls {...controlsProps} />
          {caps.disconnectCountdown && (
            <p class="disconnect-countdown">{caps.disconnectCountdown}</p>
          )}
          {caps.lobbyPopover && (
            <LobbyPopover
              variant={caps.lobbyPopover.variant}
              title={caps.lobbyPopover.title}
              settings={initialProps.value.settings}
              komi={initialProps.value.komi}
              allowUndo={allowUndo.value}
              yourColor={
                caps.lobbyPopover.variant === "challengee"
                  ? nigiri.value
                    ? "Random"
                    : playerStone.value === 1
                      ? "Black"
                      : "White"
                  : undefined
              }
              onAccept={() => channel.acceptChallenge()}
              onDecline={() => channel.declineChallenge()}
              onAbort={() => channel.abort()}
              onJoin={() => {
                const form = document.createElement("form");
                form.method = "POST";
                const token = initialProps.value.invite_token;
                form.action = `/games/${gameId.value}/join${token ? `?token=${token}` : ""}`;
                document.body.appendChild(form);
                form.submit();
              }}
              copyInviteLink={
                caps.showInviteLink
                  ? () => {
                      const token = initialProps.value.invite_token;
                      const url = `${window.location.origin}/games/${gameId.value}?token=${token}`;
                      navigator.clipboard.writeText(url);
                    }
                  : undefined
              }
            />
          )}
        </>
      }
      chat={
        <div class="chat">
          <Chat
            messages={chatMessages.value}
            onlineUsers={onlineUsers.value}
            black={black.value}
            white={white.value}
            onSend={(text) => channel.say(text)}
            showPrefix={false}
          />
        </div>
      }
      moveTree={
        <div
          class={`move-tree-slot${!caps.showMoveTree ? " hidden" : ""}`}
          ref={(el) => {
            if (el && !el.contains(moveTreeEl)) {
              el.appendChild(moveTreeEl);
            }
          }}
        />
      }
    />
  );
}
