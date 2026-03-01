import type { Point } from "../goban/types";
import { GameStage, isPlayStage } from "../game/types";
import type { TerritoryOverlay } from "../goban/create-board";
import { Chat } from "../components/chat";
import { GameInfo } from "../components/game-info";
import { GameStatus, getStatusText } from "../components/game-status";
import type { ControlsProps } from "../components/controls";
import { LobbyControls, ChallengePopover } from "../components/controls";
import type { GameChannel } from "../game/channel";
import { formatScoreStr } from "../game/ui";
import { clockDisplay } from "../game/clock";
import type { PremoveState } from "../utils/premove";
import { storage, SHOW_MOVE_TREE } from "../utils/storage";
import { GamePageLayout } from "./game-page-layout";
import { buildCoordsToggle } from "../utils/shared-controls";
import type { CoordsToggleState } from "../utils/shared-controls";
import type { PlayerPanelProps } from "../components/player-panel";
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
  chatMessages,
  analysisMode,
  estimateMode,
  undoResponseNeeded,
  opponentDisconnected,
  board,
  playerStone,
  initialProps,
  gameId,
  estimateScore,
  showMoveTree,
  moveConfirmEnabled,
  presentationActive,
  isPresenter,
  isOriginator,
  originatorId,
  currentUserId,
  controlRequest,
  presenterDisplayName,
  navState,
} from "../game/state";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LiveGamePageProps = {
  channel: GameChannel;
  pm: PremoveState;
  coordsState: CoordsToggleState;
  moveTreeEl: HTMLElement;
  gobanRef: preact.Ref<HTMLDivElement>;
  enterAnalysis: () => void;
  exitAnalysis: () => void;
  enterEstimate: () => void;
  exitEstimate: () => void;
  handleSgfExport: () => void;
  enterPresentation: () => void;
  exitPresentation: () => void;
};

// ---------------------------------------------------------------------------
// Territory overlay helpers (used by board callbacks, exported for mount)
// ---------------------------------------------------------------------------

function buildTerritoryOverlay(data: {
  ownership: number[];
  dead_stones: [number, number][];
}): TerritoryOverlay {
  const paintMap = data.ownership.map((v) => (v === 0 ? null : v));
  const dimmedVertices: Point[] = data.dead_stones.map(
    ([c, r]) => [c, r] as Point,
  );
  return { paintMap, dimmedVertices };
}

export function getServerTerritory(): TerritoryOverlay | undefined {
  if (gameStage.value === GameStage.TerritoryReview && territory.value) {
    return buildTerritoryOverlay(territory.value);
  }
  // Settled territory overlay for finished games (not in analysis — WASM handles that)
  if (estimateMode.value && settledTerritory.value && !analysisMode.value) {
    return buildTerritoryOverlay(settledTerritory.value);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Connected wrapper components
// ---------------------------------------------------------------------------

function buildLivePlayerPanel({ position }: { position: "top" | "bottom" }) {
  const b = black.value;
  const w = white.value;
  const bName = b ? b.display_name : "...";
  const wName = w ? w.display_name : "...";
  const bUrl = b ? `/users/${b.display_name}` : undefined;
  const wUrl = w ? `/users/${w.display_name}` : undefined;
  const online = onlineUsers.value;
  const bOnline = b ? online.has(b.id) : false;
  const wOnline = w ? online.has(w.id) : false;

  const score =
    estimateScore.value ??
    territory.value?.score ??
    settledTerritory.value?.score;
  const komi = initialProps.value.komi;

  const { bStr, wStr } = formatScoreStr(
    komi,
    score,
    gameState.value.captures.black,
    gameState.value.captures.white,
  );

  const cd = clockDisplay.value;

  const blackPanel: PlayerPanelProps = {
    name: bName,
    captures: bStr,
    stone: "black",
    clock: cd.blackText || undefined,
    clockLowTime: cd.blackLow,
    profileUrl: bUrl,
    isOnline: bOnline,
  };
  const whitePanel: PlayerPanelProps = {
    name: wName,
    captures: wStr,
    stone: "white",
    clock: cd.whiteText || undefined,
    clockLowTime: cd.whiteLow,
    profileUrl: wUrl,
    isOnline: wOnline,
  };

  const isWhitePlayer = playerStone.value === -1;
  if (position === "top") {
    return isWhitePlayer ? blackPanel : whitePanel;
  }
  return isWhitePlayer ? whitePanel : blackPanel;
}

// ---------------------------------------------------------------------------
// Shared state snapshot for controls builders
// ---------------------------------------------------------------------------

type GameCtx = {
  isPlayer: boolean;
  isChallenge: boolean;
  isPlay: boolean;
  isReview: boolean;
  isMyTurn: boolean;
  inAnalysis: boolean;
  inEstimate: boolean;
  modeActive: boolean;
};

function readGameCtx(): GameCtx {
  const inAnalysis = analysisMode.value;
  const inEstimate = estimateMode.value;
  return {
    isPlayer: playerStone.value !== 0,
    isChallenge: gameStage.value === GameStage.Challenge,
    isPlay: isPlayStage(gameStage.value),
    isReview: gameStage.value === GameStage.TerritoryReview,
    isMyTurn: currentTurn.value === playerStone.value,
    inAnalysis,
    inEstimate,
    modeActive: inAnalysis || inEstimate,
  };
}

// ---------------------------------------------------------------------------
// Controls sub-builders (each returns a partial ControlsProps)
// ---------------------------------------------------------------------------

/** Pass, undo request, resign, abort. */
function buildGameActions(
  channel: GameChannel,
  ctx: GameCtx,
): Partial<ControlsProps> {
  const out: Partial<ControlsProps> = {};
  const {
    isPlayer,
    isChallenge,
    isPlay,
    isMyTurn,
    inAnalysis,
    inEstimate,
    modeActive,
  } = ctx;

  if (isPlayer && (isPlay || isChallenge)) {
    if (inAnalysis && !inEstimate) {
      out.pass = {
        onClick: () => {
          board.value?.pass();
        },
      };
    } else {
      out.pass = {
        onClick: () => {},
        disabled: modeActive || isChallenge || !isMyTurn,
      };
      if (!modeActive && !isChallenge) {
        out.confirmPass = {
          message: "Pass your turn?",
          onConfirm: () => channel.pass(),
        };
      }
    }
  }

  if (isPlayer && allowUndo.value && (isPlay || isChallenge)) {
    const canUndo =
      !isChallenge &&
      moves.value.length > 0 &&
      !isMyTurn &&
      !undoRejected.value;
    out.requestUndo = {
      onClick: () => channel.requestUndo(),
      disabled: modeActive || !canUndo,
      title: isChallenge
        ? "Challenge not yet accepted"
        : undoRejected.value
          ? "Undo was rejected for this move"
          : moves.value.length === 0
            ? "No moves to undo"
            : isMyTurn
              ? "Cannot undo on your turn"
              : "Request to undo your last move",
    };
  }

  if (isPlayer && (isPlay || isChallenge)) {
    out.resign = {
      message: "Resign this game?",
      onConfirm: () => channel.resign(),
      disabled: modeActive || isChallenge,
    };
  }

  if (isPlayer && moves.value.length === 0 && !result.value) {
    const myId = playerStone.value === 1 ? black.value?.id : white.value?.id;
    const isCreator = myId != null && myId === initialProps.value.creator_id;
    // During challenge: only creator can abort. After accepted: both players can.
    if (!isChallenge || isCreator) {
      out.abort = {
        message: "Abort this game?",
        onConfirm: () => channel.abort(),
        disabled: modeActive,
      };
    }
  }

  // Analysis pass button for finished games (no stage → no pass from above)
  if (result.value && ctx.inAnalysis && !ctx.inEstimate) {
    out.pass = {
      onClick: () => {
        board.value?.pass();
      },
    };
  }

  return out;
}

/** Invite link, join, challenge accept/decline, territory accept. */
function buildLobbyControls(
  channel: GameChannel,
  ctx: GameCtx,
): Partial<ControlsProps> {
  const out: Partial<ControlsProps> = {};
  const { isPlayer, isChallenge, isReview, modeActive } = ctx;
  const hasOpenSlot = !black.value || !white.value;

  const token = initialProps.value.invite_token;
  if (token && hasOpenSlot && isPlayer) {
    out.copyInviteLink = {
      onClick: () => {
        const url = `${window.location.origin}/games/${gameId.value}?token=${token}`;
        navigator.clipboard.writeText(url);
      },
    };
  }

  if (!isPlayer && hasOpenSlot && !initialProps.value.settings.is_private) {
    out.joinGame = {
      message: "Join this game?",
      onConfirm: () => {
        const form = document.createElement("form");
        form.method = "POST";
        form.action = `/games/${gameId.value}/join`;
        document.body.appendChild(form);
        form.submit();
      },
    };
  }

  if (isReview && isPlayer) {
    const oppDisconnected = !!opponentDisconnected.value;
    const alreadyApproved =
      (playerStone.value === 1 && territory.value?.black_approved) ||
      (playerStone.value === -1 && territory.value?.white_approved);
    out.acceptTerritory = {
      message: "Accept territory?",
      onConfirm: () => channel.approveTerritory(),
      disabled: !!alreadyApproved || oppDisconnected,
    };
  }

  // Disconnect abort: show after threshold
  if (isPlayer && !result.value && opponentDisconnected.value) {
    const elapsed = Date.now() - opponentDisconnected.value.since.getTime();
    const hasOpponentMoved = moves.value.some((m) => {
      const oppStone = playerStone.value === 1 ? -1 : 1;
      return m.stone === oppStone;
    });
    const thresholdMs = hasOpponentMoved ? 15_000 : 30_000;
    if (elapsed >= thresholdMs) {
      out.disconnectAbort = {
        message: "Abort game? (Opponent disconnected)",
        onConfirm: () => channel.disconnectAbort(),
      };
    }
  }

  if (result.value && isPlayer) {
    out.rematch = {
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
      disabled: modeActive,
    };
  }

  return out;
}

/** Analyze/estimate mode toggles and SGF export. */
function buildModeControls(
  ctx: GameCtx,
  callbacks: {
    enterAnalysis: () => void;
    exitAnalysis: () => void;
    enterEstimate: () => void;
    exitEstimate: () => void;
    handleSgfExport: () => void;
  },
): Partial<ControlsProps> {
  const out: Partial<ControlsProps> = {};
  const { isPlay, isReview, inAnalysis, inEstimate } = ctx;

  if (inAnalysis) {
    out.exitAnalysis = {
      onClick: callbacks.exitAnalysis,
      disabled: inEstimate,
    };
  } else if (!isReview) {
    out.analyze = { onClick: callbacks.enterAnalysis, disabled: inEstimate };
  }

  out.sgfExport = { onClick: callbacks.handleSgfExport, disabled: inEstimate };

  if (inEstimate) {
    out.exitEstimate = {
      onClick: callbacks.exitEstimate,
      title: inAnalysis ? "Back to analysis" : undefined,
    };
  } else if (isPlay && !isReview) {
    out.estimate = { onClick: callbacks.enterEstimate };
  } else if (result.value && settledTerritory.value) {
    out.estimate = {
      onClick: callbacks.enterEstimate,
      title: "Show territory",
    };
  }

  return out;
}

/** Presentation overrides: analyze triggers presentation, viewer choice popover, control request modal. */
function buildPresentationControls(
  channel: GameChannel,
  ctx: GameCtx,
  callbacks: {
    enterAnalysis: () => void;
    enterPresentation: () => void;
    exitPresentation: () => void;
  },
): Partial<ControlsProps> {
  const out: Partial<ControlsProps> = {};

  // Game done + no active presentation: analyze button starts presentation
  if (result.value && !presentationActive.value) {
    out.analyze = { onClick: callbacks.enterPresentation };
  }

  if (!presentationActive.value) {
    return out;
  }

  // Control request popover: originator always handles requests
  if (isOriginator.value && controlRequest.value) {
    out.controlRequestResponse = {
      displayName: controlRequest.value.displayName,
      onGive: () => channel.giveControl(controlRequest.value!.userId),
      onDismiss: () => channel.rejectControlRequest(),
    };
  }

  // Presenter: exit analysis ends the presentation or returns control
  if (isPresenter.value) {
    out.exitAnalysis = isOriginator.value
      ? { onClick: callbacks.exitPresentation }
      : { onClick: () => channel.giveControl(originatorId.value) };
  } else if (!ctx.inAnalysis) {
    // Viewer (not in personal analysis): analyze button opens choice popover
    const options: Array<{ label: string; onClick: () => void; disabled?: boolean }> = [];

    if (isOriginator.value) {
      options.push({
        label: "Take control",
        onClick: () => channel.takeControl(),
      });
    } else {
      const myRequest =
        controlRequest.value?.userId === currentUserId.value;
      if (myRequest) {
        options.push({
          label: "Cancel request",
          onClick: () => channel.cancelControlRequest(),
        });
      } else if (controlRequest.value) {
        options.push({
          label: `${controlRequest.value.displayName} request pending`,
          onClick: () => {},
          disabled: true,
        });
      } else {
        options.push({
          label: "Request control",
          onClick: () => channel.requestControl(),
        });
      }
    }
    options.push({
      label: "Analyze (local)",
      onClick: callbacks.enterAnalysis,
    });

    out.analyzeChoice = { options };
  }

  return out;
}

// ---------------------------------------------------------------------------
// Main controls builder (orchestrates sub-builders)
// ---------------------------------------------------------------------------

function buildLiveControls({
  channel,
  pm,
  coordsState,
  enterAnalysis,
  exitAnalysis,
  enterEstimate,
  exitEstimate,
  handleSgfExport,
  enterPresentation,
  exitPresentation,
  setMoveTree,
}: {
  channel: GameChannel;
  pm: PremoveState;
  coordsState: CoordsToggleState;
  enterAnalysis: () => void;
  exitAnalysis: () => void;
  enterEstimate: () => void;
  exitEstimate: () => void;
  handleSgfExport: () => void;
  enterPresentation: () => void;
  exitPresentation: () => void;
  setMoveTree: (visible: boolean) => void;
}): ControlsProps {
  const ctx = readGameCtx();

  const ns = navState.value;
  const nav: ControlsProps["nav"] = {
    atStart: ns.atStart,
    atLatest: ns.atLatest,
    atMainEnd: ns.atMainEnd,
    counter: ns.counter,
    onNavigate: (action) => board.value?.navigate(action),
  };

  const props: ControlsProps = {
    nav,
    coordsToggle: buildCoordsToggle(board.value, coordsState),
    moveConfirmToggle:
      ctx.isPlayer && ctx.isPlay
        ? {
            enabled: moveConfirmEnabled.value,
            onClick: () => {
              pm.enabled = !pm.enabled;
              moveConfirmEnabled.value = pm.enabled;
              pm.clear();
              board.value?.render();
            },
          }
        : undefined,
    moveTreeToggle: {
      enabled: showMoveTree.value,
      onClick: () => setMoveTree(!showMoveTree.value),
    },
    ...buildGameActions(channel, ctx),
    ...buildLobbyControls(channel, ctx),
    ...buildModeControls(ctx, {
      enterAnalysis,
      exitAnalysis,
      enterEstimate,
      exitEstimate,
      handleSgfExport,
    }),
    ...buildPresentationControls(channel, ctx, {
      enterAnalysis,
      enterPresentation,
      exitPresentation,
    }),
  };

  // Disable nav for viewers watching a presentation (not in personal analysis)
  if (presentationActive.value && !isPresenter.value && !ctx.inAnalysis) {
    props.nav = { ...props.nav, atStart: true, atLatest: true, atMainEnd: true };
  }

  // Undo response popover
  if (undoResponseNeeded.value && ctx.isPlayer) {
    props.undoResponse = {
      onAccept: () => {
        undoResponseNeeded.value = false;
        channel.acceptUndo();
      },
      onReject: () => {
        undoResponseNeeded.value = false;
        channel.rejectUndo();
      },
    };
  }

  // Confirm move button
  if (pm.value && ctx.isMyTurn && !ctx.inAnalysis) {
    props.confirmMove = {
      onClick: () => {
        if (pm.value) {
          const [col, row] = pm.value;
          pm.clear();
          channel.play(col, row);
        }
      },
    };
  }

  return props;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export function LiveGamePage(props: LiveGamePageProps) {
  const {
    channel,
    pm,
    coordsState,
    moveTreeEl,
    gobanRef,
    enterAnalysis,
    exitAnalysis,
    enterEstimate,
    exitEstimate,
    handleSgfExport,
    enterPresentation,
    exitPresentation,
  } = props;

  function setMoveTree(visible: boolean) {
    showMoveTree.value = visible;
    storage.set(SHOW_MOVE_TREE, String(visible));
    if (visible) {
      board.value?.setMoveTreeEl(moveTreeEl);
    } else {
      board.value?.setMoveTreeEl(null);
    }
    board.value?.render();
  }

  const controlsProps = buildLiveControls({
    channel,
    pm,
    coordsState,
    enterAnalysis,
    exitAnalysis,
    enterEstimate,
    exitEstimate,
    handleSgfExport,
    enterPresentation,
    exitPresentation,
    setMoveTree,
  });

  const creatorId = initialProps.value.creator_id;
  const myId = playerStone.value === 1 ? black.value?.id : white.value?.id;
  const isChallengee =
    gameStage.value === GameStage.Challenge &&
    playerStone.value !== 0 &&
    myId != null &&
    myId !== creatorId;
  const challengee =
    black.value?.id !== creatorId ? black.value : white.value;

  const lastMove = moves.value[moves.value.length - 1];
  let statusText = getStatusText({
    stage: gameStage.value,
    result: result.value ?? undefined,
    komi: initialProps.value.komi,
    estimateScore: estimateMode.value ? estimateScore.value : undefined,
    territoryScore: territory.value?.score,
    lastMoveWasPass: lastMove?.kind === "pass",
    isChallengeCreator: myId != null && myId === creatorId,
    challengeWaitingFor: challengee?.display_name,
    hasOpenSlot: !black.value || !white.value,
  });

  if (statusText && presentationActive.value) {
    if (isPresenter.value) {
      statusText += " (You are presenting)";
    } else if (presenterDisplayName.value) {
      statusText += ` (${presenterDisplayName.value} presenting)`;
    }
  }

  return (
    <GamePageLayout
      gobanRef={gobanRef}
      gobanStyle={`aspect-ratio: ${gameState.value.cols}/${gameState.value.rows}`}
      gobanClass={analysisMode.value ? "goban-analysis" : undefined}
      playerTop={buildLivePlayerPanel({ position: "top" })}
      playerBottom={buildLivePlayerPanel({ position: "bottom" })}
      controls={controlsProps}
      info={
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
          estimateScore={estimateMode.value ? estimateScore.value : undefined}
        />
      }
      status={
        <>
          {statusText && <GameStatus text={statusText} />}
          <LobbyControls {...controlsProps} />
          {isChallengee && (
            <ChallengePopover
              settings={initialProps.value.settings}
              komi={initialProps.value.komi}
              allowUndo={allowUndo.value}
              challengerName={
                (black.value?.id === creatorId
                  ? black.value?.display_name
                  : white.value?.display_name) ?? "?"
              }
              yourColor={playerStone.value === 1 ? "Black" : "White"}
              onAccept={() => channel.acceptChallenge()}
              onDecline={() => channel.declineChallenge()}
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
        showMoveTree.value ? (
          <div
            class="move-tree-slot"
            ref={(el) => {
              if (el && !el.contains(moveTreeEl)) {
                el.appendChild(moveTreeEl);
              }
            }}
          />
        ) : undefined
      }
    />
  );
}
