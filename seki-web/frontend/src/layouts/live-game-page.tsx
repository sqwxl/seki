import {
  GameStage,
  isPlayStage,
  type Point,
  type SettledTerritoryData,
} from "../goban/types";
import type { TerritoryOverlay } from "../goban/create-board";
import { Chat } from "../components/chat";
import type { ControlsProps } from "../components/controls";
import { formatResult, formatPoints } from "../utils/format";
import type { GameChannel } from "../game/channel";
import { formatScoreStr } from "../game/ui";
import { clockDisplay } from "../game/clock";
import type { PremoveState } from "../utils/premove";
import { storage, SHOW_MOVE_TREE } from "../utils/storage";
import { GamePageLayout } from "./game-page-layout";
import { GameDescription } from "../components/game-description";
import {
  buildNavProps,
  buildCoordsToggle,
} from "../utils/shared-controls";
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

export function getServerTerritory(): TerritoryOverlay | undefined {
  if (
    gameStage.value === GameStage.TerritoryReview &&
    territory.value
  ) {
    const paintMap = territory.value.ownership.map((v) =>
      v === 0 ? null : v,
    );
    const dimmedVertices: Point[] = territory.value.dead_stones.map(
      ([c, r]) => [c, r] as Point,
    );
    return { paintMap, dimmedVertices };
  }
  // Settled territory overlay for finished games (not in analysis — WASM handles that)
  if (estimateMode.value && settledTerritory.value && !analysisMode.value) {
    return buildSettledOverlay(settledTerritory.value);
  }
  return undefined;
}

function buildSettledOverlay(st: SettledTerritoryData): TerritoryOverlay {
  const paintMap = st.ownership.map((v) => (v === 0 ? null : v));
  const dimmedVertices: Point[] = st.dead_stones.map(
    ([c, r]) => [c, r] as Point,
  );
  return { paintMap, dimmedVertices };
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

function LivePlayerPanel({
  position,
}: {
  position: "top" | "bottom";
}) {
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

  let bStr: string;
  let wStr: string;
  if (score) {
    ({ bStr, wStr } = formatScoreStr(score, komi));
  } else {
    ({ bStr, wStr } = formatPoints(
      gameState.value.captures.black,
      gameState.value.captures.white,
      komi,
    ));
  }

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

function LiveControls({
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
}) {
  const isChallenge = gameStage.value === GameStage.Challenge;
  const isPlay = isPlayStage(gameStage.value);
  const isReview = gameStage.value === GameStage.TerritoryReview;
  const isMyTurn = currentTurn.value === playerStone.value;
  const isPlayerVal = playerStone.value !== 0;

  const inAnalysis = analysisMode.value;
  const inEstimate = estimateMode.value;
  const modeActive = inAnalysis || inEstimate;

  const nav = buildNavProps(board.value);

  // Show result in nav counter when available
  let resultStr: string | undefined;
  if (estimateScore.value) {
    resultStr = formatResult(estimateScore.value, initialProps.value.komi);
  } else if (isReview && territory.value?.score) {
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
    moveConfirmToggle: {
      enabled: moveConfirmEnabled.value,
      onClick: () => {
        pm.enabled = !pm.enabled;
        moveConfirmEnabled.value = pm.enabled;
        pm.clear();
        board.value?.render();
      },
    },
    moveTreeToggle: {
      enabled: showMoveTree.value,
      onClick: () => setMoveTree(!showMoveTree.value),
    },
  };

  // --- Game action buttons (controls-start) ---
  // Always shown based on game state; disabled in analysis/estimate modes.

  if (isPlayerVal && (isPlay || isChallenge)) {
    if (inAnalysis && !inEstimate) {
      // Analysis pass — no confirmation needed
      props.pass = {
        onClick: () => {
          board.value?.pass();
        },
      };
    } else {
      props.pass = {
        onClick: () => {},
        disabled: modeActive || isChallenge || !isMyTurn,
      };
      if (!modeActive && !isChallenge) {
        props.confirmPass = {
          message: "Pass your turn?",
          onConfirm: () => channel.pass(),
        };
      }
    }
  }

  if (isPlayerVal && allowUndo.value && (isPlay || isChallenge)) {
    const canUndo =
      !isChallenge && moves.value.length > 0 && !isMyTurn && !undoRejected.value;
    props.requestUndo = {
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

  if (isPlay || isChallenge) {
    props.resign = {
      message: "Resign this game?",
      onConfirm: () => channel.resign(),
      disabled: modeActive || isChallenge,
    };
  }

  const canAbort =
    isPlayerVal && moves.value.length === 0 && !result.value;
  if (canAbort) {
    props.abort = {
      message: "Abort this game?",
      onConfirm: () => channel.abort(),
      disabled: modeActive,
    };
  }

  // Copy invite link (creator only, while waiting for opponent)
  const token = initialProps.value.invite_token;
  const hasOpenSlot = !black.value || !white.value;
  if (token && hasOpenSlot && isPlayerVal) {
    props.copyInviteLink = {
      onClick: () => {
        const url = `${window.location.origin}/games/${gameId.value}?token=${token}`;
        navigator.clipboard.writeText(url);
      },
    };
  }

  // Challenge accept/decline (challengee only — not the creator)
  if (isChallenge && isPlayerVal) {
    const myId =
      playerStone.value === 1
        ? black.value?.id
        : white.value?.id;
    const isCreator = myId != null && myId === initialProps.value.creator_id;
    if (!isCreator) {
      props.acceptChallenge = {
        onClick: () => channel.acceptChallenge(),
      };
      props.declineChallenge = {
        message: "Decline this challenge?",
        onConfirm: () => channel.declineChallenge(),
      };
    }
  }

  if (isReview && isPlayerVal) {
    const alreadyApproved =
      (playerStone.value === 1 && territory.value?.black_approved) ||
      (playerStone.value === -1 && territory.value?.white_approved);
    props.acceptTerritory = {
      message: "Accept territory?",
      onConfirm: () => channel.approveTerritory(),
      disabled: !!alreadyApproved,
    };
  }

  // --- Board control buttons ---
  // Swap analyze/exitAnalysis and estimate/exitEstimate; disable where needed.

  if (inAnalysis) {
    props.exitAnalysis = { onClick: exitAnalysis, disabled: inEstimate };
  } else if (!isReview) {
    props.analyze = { onClick: enterAnalysis, disabled: inEstimate };
  }

  props.sgfExport = { onClick: handleSgfExport, disabled: inEstimate };

  if (inEstimate) {
    props.exitEstimate = {
      onClick: exitEstimate,
      title: inAnalysis ? "Back to analysis" : undefined,
    };
  } else if (isPlay && !isReview) {
    props.estimate = { onClick: enterEstimate };
  } else if (result.value && settledTerritory.value) {
    props.estimate = { onClick: enterEstimate, title: "Show territory" };
  }

  if (result.value && isPlayerVal) {
    props.rematch = {
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

  // Undo response popover
  if (undoResponseNeeded.value && isPlayerVal) {
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
  if (pm.value && isMyTurn && !analysisMode.value) {
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

  const controlsProps = LiveControls({
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
      playerTop={LivePlayerPanel({ position: "top" })}
      playerBottom={LivePlayerPanel({ position: "bottom" })}
      controls={controlsProps}
      sidebar={
        <LiveSidebar channel={channel} moveTreeEl={moveTreeEl} />
      }
    />
  );
}
