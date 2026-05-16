import { useEffect, useState } from "preact/hooks";
import { Chat } from "../components/chat";
import type { ControlsProps } from "../components/controls";
import { LobbyControls, LobbyPopover } from "../components/controls";
import { GameInfo } from "../components/game-info";
import { GameStatus } from "../components/game-status";
import { PlayerPanel } from "../components/player-panel";
import { TabBar } from "../components/tab-bar";
import {
  buildTerritoryOverlay,
  liveGameControlsState,
  liveGameMoveTreeState,
  liveGamePanelState,
  liveGameStatusState,
  type LiveGameControlsState,
  type LiveGameStatusState,
} from "../game/capabilities";
import type { GameChannel } from "../game/channel";
import {
  addPendingChatMessage,
  allowUndo,
  black,
  board,
  boardFinalized,
  boardFinalizedScore,
  chatMessages,
  clearGameFlashMessage,
  clearPendingAction,
  currentUserId,
  estimateMode,
  estimateScore,
  gameId,
  gameStage,
  gameState,
  hasUnreadChat,
  initialProps,
  isPendingAction,
  moves,
  nigiri,
  onlineUsers,
  pendingMove,
  playerStone,
  result,
  setGameFlashMessage,
  setPendingAction,
  settledTerritory,
  territory,
  white,
} from "../game/state";
import { GameStage } from "../game/types";
import { readUserData } from "../game/util";
import type { NavAction, TerritoryOverlay } from "../goban/create-board";
import { formatResult } from "../utils/format";
import type { MoveConfirmState } from "../utils/move-confirm";
import { requestSpaNavigation } from "../utils/spa-navigation";
import { postForm, type WebRequestError } from "../utils/web-client";
import { Controls } from "./controls";
import { GamePageLayout } from "./game-page-layout";

function supportsPopoverSpectating(
  variant: NonNullable<LiveGameStatusState["lobbyPopover"]>["variant"],
): boolean {
  return variant === "visitor-open" || variant === "visitor-challenge";
}

export function shouldFallbackJoinToSpectating(err: WebRequestError): boolean {
  return err.status === 422 && err.message === "Game is full";
}

function buildShareGameUrl(): string {
  const accessToken = initialProps.value.access_token;
  return initialProps.value.settings.is_private && accessToken
    ? `${window.location.origin}/games/${gameId.value}?access_token=${accessToken}`
    : `${window.location.origin}/games/${gameId.value}`;
}

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
  caps: LiveGameControlsState,
  props: LiveGamePageProps,
): ControlsProps {
  const { channel, mc } = props;
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
    };
  }

  // --- Analysis / Presentation toggle (single button) ---
  if (caps.canReturnControl) {
    controlsProps.analyze = {
      onClick: () => runPendingAction("give-control", props.returnControl),
      active: true,
      pending: pendingGiveControl,
    };
  } else if (caps.canExitPresentation) {
    controlsProps.analyze = {
      onClick: () =>
        runPendingAction("end-presentation", props.exitPresentation),
      active: true,
      pending: pendingEndPresentation,
    };
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
      onClick: props.enterAnalysis,
    });

    controlsProps.analyzeChoice = { options };
    controlsProps.analyze = { onClick: () => {} };
  } else if (caps.canEnterPresentation) {
    controlsProps.analyze = {
      onClick: () =>
        runPendingAction("start-presentation", props.enterPresentation),
      pending: pendingStartPresentation,
    };
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

  return controlsProps;
}

function LiveGameTopPanel() {
  return <PlayerPanel {...liveGamePanelState.value.topPanel} />;
}

function LiveGameBottomPanel() {
  return <PlayerPanel {...liveGamePanelState.value.bottomPanel} />;
}

function LiveGameControls(props: LiveGamePageProps) {
  return <Controls {...buildControls(liveGameControlsState.value, props)} />;
}

function LiveGameStatusSlot(
  props: LiveGamePageProps & {
    isSpectatingPopover: boolean;
    onSpectate: () => void;
    onCancelSpectate: () => void;
  },
) {
  const status = liveGameStatusState.value;
  const fullStatusText = status.statusText + status.presentationStatusSuffix;
  const pendingLobbyAction = isPendingAction("accept-challenge")
    ? "accept"
    : isPendingAction("decline-challenge")
      ? "decline"
      : isPendingAction("abort")
        ? "abort"
        : isPendingAction("join-game")
          ? "join"
          : undefined;
  const finalizedScore =
    boardFinalized.value && boardFinalizedScore.value
      ? boardFinalizedScore.value
      : undefined;
  const infoStage =
    boardFinalized.value && (finalizedScore || result.value)
      ? GameStage.Completed
      : gameStage.value;
  const infoResult = finalizedScore
    ? formatResult(finalizedScore, initialProps.value.komi)
    : (result.value ?? undefined);
  const infoEstimateScore =
    estimateMode.value || boardFinalized.value
      ? (estimateScore.value ?? finalizedScore)
      : undefined;

  return (
    <>
      {fullStatusText && (
        <GameStatus text={fullStatusText}>
          <GameInfo
            settings={initialProps.value.settings}
            komi={initialProps.value.komi}
            stage={infoStage}
            moveCount={moves.value.length}
            result={infoResult}
            black={black.value}
            white={white.value}
            capturesBlack={gameState.value.captures.black}
            capturesWhite={gameState.value.captures.white}
            territory={territory.value}
            settledTerritory={settledTerritory.value}
            estimateScore={infoEstimateScore}
            copyInviteLink={() => {
              navigator.clipboard.writeText(buildShareGameUrl());
            }}
          />
        </GameStatus>
      )}
      <LobbyControls {...buildControls(liveGameControlsState.value, props)} />
      {/* TODO: Put this in the proper place. {status.disconnectCountdown && ( */}
      {/*   <p class="disconnect-countdown">{status.disconnectCountdown}</p> */}
      {/* )} */}
      {status.lobbyPopover && (
        <LobbyPopover
          variant={status.lobbyPopover.variant}
          title={status.lobbyPopover.title}
          settings={initialProps.value.settings}
          komi={initialProps.value.komi}
          allowUndo={allowUndo.value}
          rated={initialProps.value.settings.ranked}
          yourColor={
            status.lobbyPopover.variant === "challengee"
              ? nigiri.value
                ? "Random"
                : playerStone.value === 1
                  ? "Black"
                  : "White"
              : undefined
          }
          pendingAction={pendingLobbyAction}
          showAbort={liveGameControlsState.value.canAbort}
          isSpectating={
            props.isSpectatingPopover &&
            supportsPopoverSpectating(status.lobbyPopover.variant)
          }
          onAccept={() => {
            clearGameFlashMessage();
            if (!setPendingAction("accept-challenge")) {
              return;
            }
            props.channel.acceptChallenge();
          }}
          onDecline={() => {
            clearGameFlashMessage();
            if (!setPendingAction("decline-challenge")) {
              return;
            }
            props.channel.declineChallenge();
          }}
          onAbort={() => {
            clearGameFlashMessage();
            if (!setPendingAction("abort")) {
              return;
            }
            props.channel.abort();
          }}
          onJoin={() => {
            clearGameFlashMessage();
            if (!setPendingAction("join-game")) {
              return;
            }
            const accessToken = initialProps.value.access_token;
            const url = `/games/${gameId.value}/join${accessToken ? `?access_token=${accessToken}` : ""}`;
            void postForm(url, new FormData())
              .then((result) => {
                if (typeof result.redirect === "string") {
                  requestSpaNavigation(result.redirect, {
                    replace: true,
                    reload: true,
                  });
                }
              })
              .catch((err: WebRequestError) => {
                if (shouldFallbackJoinToSpectating(err)) {
                  clearPendingAction("join-game");
                  props.onSpectate();
                  return;
                }
                clearPendingAction("join-game");
                setGameFlashMessage(err.message);
              });
          }}
          onSpectate={props.onSpectate}
          onCancelSpectate={props.onCancelSpectate}
          copyInviteLink={
            status.showInviteLink
              ? () => {
                  navigator.clipboard.writeText(buildShareGameUrl());
                }
              : undefined
          }
        />
      )}
    </>
  );
}

function LiveGameMoveTree({ moveTreeEl }: { moveTreeEl: HTMLElement }) {
  const showMoveTree = liveGameMoveTreeState.value.showMoveTree;
  return (
    <div
      class={`move-tree-slot${!showMoveTree ? " hidden" : ""}`}
      ref={(el) => {
        if (el && !el.contains(moveTreeEl)) {
          el.appendChild(moveTreeEl);
        }
      }}
    />
  );
}

function LiveGameTabBar(props: LiveGamePageProps) {
  return (
    <TabBar controls={buildControls(liveGameControlsState.value, props)} />
  );
}

function LiveGameChat({ channel }: Pick<LiveGamePageProps, "channel">) {
  const userData = readUserData();

  function handleSendChat(text: string) {
    const clientMessageId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    addPendingChatMessage({
      client_message_id: clientMessageId,
      user_id: currentUserId.value || userData?.id,
      display_name: userData?.display_name,
      text,
    });
    hasUnreadChat.value = false;
    channel.say(text, clientMessageId);
  }

  return (
    <div class="chat">
      <Chat
        messages={chatMessages.value}
        onlineUsers={onlineUsers.value}
        black={black.value}
        white={white.value}
        onSend={handleSendChat}
        showPrefix={false}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export function LiveGamePage(props: LiveGamePageProps) {
  const { channel, moveTreeEl, gobanRef } = props;
  const [isSpectatingPopover, setIsSpectatingPopover] = useState(false);

  useEffect(() => {
    const popover = liveGameStatusState.value.lobbyPopover;
    if (!popover || !supportsPopoverSpectating(popover.variant)) {
      setIsSpectatingPopover(false);
    }
  });

  return (
    <GamePageLayout
      gobanRef={gobanRef}
      gobanStyle={`aspect-ratio: ${gameState.value.cols}/${gameState.value.rows}`}
      playerTop={<LiveGameTopPanel />}
      playerBottom={<LiveGameBottomPanel />}
      controls={<LiveGameControls {...props} />}
      status={
        <LiveGameStatusSlot
          {...props}
          isSpectatingPopover={isSpectatingPopover}
          onSpectate={() => setIsSpectatingPopover(true)}
          onCancelSpectate={() => setIsSpectatingPopover(false)}
        />
      }
      chat={<LiveGameChat channel={channel} />}
      moveTree={<LiveGameMoveTree moveTreeEl={moveTreeEl} />}
      tabBar={<LiveGameTabBar {...props} />}
    />
  );
}
