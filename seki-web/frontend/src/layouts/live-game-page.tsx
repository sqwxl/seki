import type { Point } from "../goban/types";
import { GameStage, isPlayStage } from "../game/types";
import type { TerritoryOverlay } from "../goban/create-board";
import { Chat } from "../components/chat";
import type { ControlsProps } from "../components/controls";
import { formatResult } from "../utils/format";
import type { GameChannel } from "../game/channel";
import { formatScoreStr } from "../game/ui";
import { clockDisplay } from "../game/clock";
import type { PremoveState } from "../utils/premove";
import { storage, SHOW_MOVE_TREE } from "../utils/storage";
import { GamePageLayout } from "./game-page-layout";
import { GameDescription } from "../components/game-description";
import { buildNavProps, buildCoordsToggle } from "../utils/shared-controls";
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

function LiveHeader() {
  let subtitle: string | undefined;
  if (gameStage.value === GameStage.Challenge) {
    const creatorId = initialProps.value.creator_id;
    const challengee =
      black.value?.id !== creatorId ? black.value : white.value;
    if (challengee) {
      subtitle = `Waiting for ${challengee.display_name} to accept`;
    }
  }

  return (
    <>
      <h2>
        <GameDescription
          id={gameId.value}
          creator_id={initialProps.value.creator_id}
          black={black.value}
          white={white.value}
          settings={initialProps.value.settings}
          stage={gameStage.value}
          result={result.value ?? undefined}
          move_count={moves.value.length > 0 ? moves.value.length : undefined}
        />
      </h2>
      {subtitle && <h3>{subtitle}</h3>}
    </>
  );
}

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
  const bTurn = gameStage.value === GameStage.BlackToPlay;
  const wTurn = gameStage.value === GameStage.WhiteToPlay;

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
    isTurn: bTurn,
  };
  const whitePanel: PlayerPanelProps = {
    name: wName,
    captures: wStr,
    stone: "white",
    clock: cd.whiteText || undefined,
    clockLowTime: cd.whiteLow,
    profileUrl: wUrl,
    isOnline: wOnline,
    isTurn: wTurn,
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
    out.abort = {
      message: "Abort this game?",
      onConfirm: () => channel.abort(),
      disabled: modeActive,
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
      onClick: () => {
        const form = document.createElement("form");
        form.method = "POST";
        form.action = `/games/${gameId.value}/join`;
        document.body.appendChild(form);
        form.submit();
      },
    };
  }

  if (isChallenge && isPlayer) {
    const myId = playerStone.value === 1 ? black.value?.id : white.value?.id;
    const isCreator = myId != null && myId === initialProps.value.creator_id;
    if (!isCreator) {
      out.acceptChallenge = { onClick: () => channel.acceptChallenge() };
      out.declineChallenge = {
        message: "Decline this challenge?",
        onConfirm: () => channel.declineChallenge(),
      };
    }
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
  setMoveTree: (visible: boolean) => void;
}): ControlsProps {
  const ctx = readGameCtx();

  const nav = buildNavProps(board.value);

  // Append result to nav counter when available
  let resultStr: string | undefined;
  if (estimateScore.value) {
    resultStr = formatResult(estimateScore.value, initialProps.value.komi);
  } else if (ctx.isReview && territory.value?.score) {
    resultStr = formatResult(territory.value.score, initialProps.value.komi);
  } else if (result.value && board.value?.engine.is_at_latest()) {
    resultStr = result.value;
  }
  if (resultStr) {
    nav.counter = `${nav.counter} (${resultStr})`;
  }

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
  };

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

function LiveSidebar({
  channel,
  moveTreeEl,
}: {
  channel: GameChannel;
  moveTreeEl: HTMLElement;
}) {
  return (
    <>
      <div class="chat">
        <Chat
          messages={chatMessages.value}
          onlineUsers={onlineUsers.value}
          black={black.value}
          white={white.value}
          onSend={(text) => channel.say(text)}
          showPrefix={false} // TODO: Make this configurable
        />
      </div>
      {showMoveTree.value && (
        <div
          class="move-tree-slot"
          ref={(el) => {
            if (el && !el.contains(moveTreeEl)) {
              el.appendChild(moveTreeEl);
            }
          }}
        />
      )}
    </>
  );
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
    setMoveTree,
  });

  return (
    <GamePageLayout
      header={<LiveHeader />}
      gobanRef={gobanRef}
      gobanStyle={`aspect-ratio: ${gameState.value.cols}/${gameState.value.rows}`}
      gobanClass={analysisMode.value ? "goban-analysis" : undefined}
      playerTop={buildLivePlayerPanel({ position: "top" })}
      playerBottom={buildLivePlayerPanel({ position: "bottom" })}
      controls={controlsProps}
      sidebar={<LiveSidebar channel={channel} moveTreeEl={moveTreeEl} />}
    />
  );
}
