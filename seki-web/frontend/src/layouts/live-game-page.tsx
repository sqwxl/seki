import { useEffect, useState } from "preact/hooks";
import { Chat } from "../components/chat";
import { GameInfo } from "../components/game-info";
import { GameStatus } from "../components/game-status";
import { LobbyControls } from "../components/lobby-controls";
import {
  LobbyPopover,
  PregameSettingsPopover,
} from "../components/lobby-popover";
import { PlayerPanel } from "../components/player-panel";
import { TabBar } from "../components/tab-bar";
import {
  liveGameControlsState,
  liveGamePanelState,
  liveGameStatusState,
  type LiveGameStatusState,
} from "../game/capabilities";
import type { GameChannel } from "../game/channel";
import {
  addPendingChatMessage,
  allowUndo,
  black,
  boardFinalized,
  boardFinalizedScore,
  chatMessages,
  clearGameFlashMessage,
  clearPendingAction,
  creator,
  currentUserId,
  estimateMode,
  estimateScore,
  gameId,
  gameStage,
  gameState,
  hasUnreadChat,
  initialProps,
  isPendingAction,
  mobileTab,
  moves,
  nigiri,
  onlineUsers,
  opponent,
  playerStone,
  pregameSettings,
  result,
  setGameFlashMessage,
  setPendingAction,
  settledTerritory,
  territory,
  white,
} from "../game/state";
import { GameStage } from "../game/types";
import { readUserData } from "../game/util";
import { formatResult } from "../utils/format";
import type { MoveConfirmState } from "../utils/move-confirm";
import { postForm, type WebRequestError } from "../utils/web-client";
import { Controls } from "./controls";
import { GamePageLayout } from "./game-page-layout";
import {
  buildControls,
  buildShareGameUrl,
  getServerTerritory,
} from "./live-game/phase-transitions";

function supportsPopoverSpectating(
  variant: NonNullable<LiveGameStatusState["lobbyPopover"]>["variant"],
): boolean {
  return variant === "visitor-open" || variant === "visitor-challenge";
}

export function shouldFallbackJoinToSpectating(err: WebRequestError): boolean {
  return err.status === 422 && err.message === "Game is full";
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

export { buildShareGameUrl, getServerTerritory };

function LiveGameTopPanel() {
  return <PlayerPanel {...liveGamePanelState.value.topPanel} />;
}

function LiveGameBottomPanel() {
  return <PlayerPanel {...liveGamePanelState.value.bottomPanel} />;
}

function LiveGameControls(props: LiveGamePageProps) {
  const compact = IS_MOBILE && mobileTab.value === "analysis";
  return (
    <Controls
      {...buildControls(liveGameControlsState.value, props.channel, props.mc, {
        enterAnalysis: props.enterAnalysis,
        exitAnalysis: props.exitAnalysis,
        enterEstimate: props.enterEstimate,
        exitEstimate: props.exitEstimate,
        handleSgfExport: props.handleSgfExport,
        enterPresentation: props.enterPresentation,
        exitPresentation: props.exitPresentation,
        returnControl: props.returnControl,
      })}
      compact={compact}
    />
  );
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
  const pendingPregameAction = isPendingAction("accept-pregame-settings")
    ? "accept"
    : isPendingAction("reject-pregame-settings")
      ? "reject"
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

  useEffect(() => {
    const expiresAt = pregameSettings.value?.expires_at;

    if (!expiresAt) {
      return;
    }

    const delay = Math.max(0, new Date(expiresAt).getTime() - Date.now() + 250);
    const id = window.setTimeout(
      () => props.channel.pregameSettingsTimeoutFlag(),
      delay,
    );

    return () => window.clearTimeout(id);
  }, [pregameSettings.value?.expires_at, props.channel]);

  return (
    <>
      {fullStatusText && (
        <GameStatus
          text={fullStatusText}
          warn={infoStage === GameStage.Aborted}
        >
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
      <LobbyControls
        {...buildControls(
          liveGameControlsState.value,
          props.channel,
          props.mc,
          {
            enterAnalysis: props.enterAnalysis,
            exitAnalysis: props.exitAnalysis,
            enterEstimate: props.enterEstimate,
            exitEstimate: props.exitEstimate,
            handleSgfExport: props.handleSgfExport,
            enterPresentation: props.enterPresentation,
            exitPresentation: props.exitPresentation,
            returnControl: props.returnControl,
          },
        )}
      />
      {pregameSettings.value && gameStage.value === GameStage.Unstarted ? (
        <PregameSettingsPopover
          title="Confirm game settings"
          settings={initialProps.value.settings}
          pregame={pregameSettings.value}
          allowUndo={allowUndo.value}
          disabled={
            currentUserId.value !== initialProps.value.creator_id &&
            currentUserId.value !== opponent.value?.id
          }
          isCreator={currentUserId.value === initialProps.value.creator_id}
          creator={creator.value}
          joiner={opponent.value}
          pendingAction={pendingPregameAction}
          onUpdate={(settings) => props.channel.updatePregameSettings(settings)}
          onAccept={() => {
            clearGameFlashMessage();
            if (!setPendingAction("accept-pregame-settings")) {
              return;
            }
            props.channel.acceptPregameSettings();
          }}
          onReject={() => {
            clearGameFlashMessage();
            if (!setPendingAction("reject-pregame-settings")) {
              return;
            }
            props.channel.rejectPregameSettings();
          }}
        />
      ) : status.lobbyPopover ? (
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
          canJoin={status.canJoinGame}
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
              .then(() => {
                clearPendingAction("join-game");
                if (accessToken) {
                  window.history.replaceState(
                    null,
                    "",
                    `/games/${gameId.value}`,
                  );
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
      ) : null}
    </>
  );
}

const IS_MOBILE =
  typeof window !== "undefined" &&
  window.matchMedia("(max-width: 767px)").matches;

function LiveGameMoveTree({ moveTreeEl }: { moveTreeEl: HTMLElement }) {
  const visible = !IS_MOBILE || mobileTab.value === "analysis";

  return (
    <div
      class={`move-tree-slot${!visible ? " hidden" : ""}`}
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
    <TabBar
      controls={buildControls(
        liveGameControlsState.value,
        props.channel,
        props.mc,
        {
          enterAnalysis: props.enterAnalysis,
          exitAnalysis: props.exitAnalysis,
          enterEstimate: props.enterEstimate,
          exitEstimate: props.exitEstimate,
          handleSgfExport: props.handleSgfExport,
          enterPresentation: props.enterPresentation,
          exitPresentation: props.exitPresentation,
          returnControl: props.returnControl,
        },
      )}
    />
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
      user_data: userData ?? null,
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
