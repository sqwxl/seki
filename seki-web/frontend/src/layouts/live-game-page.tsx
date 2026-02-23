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
  buildMoveConfirmToggle,
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
  errorMessage,
  board,
  playerStone,
  initialProps,
  gameId,
  estimateScore,
  showMoveTree,
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
  return (
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
  const isPlay = isPlayStage(gameStage.value);
  const isReview = gameStage.value === GameStage.TerritoryReview;
  const isMyTurn = currentTurn.value === playerStone.value;
  const isPlayerVal = playerStone.value !== 0;

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
    moveConfirmToggle: buildMoveConfirmToggle(pm, board.value),
    moveTreeToggle: {
      enabled: showMoveTree.value,
      onClick: () => setMoveTree(!showMoveTree.value),
    },
  };

  if (analysisMode.value) {
    if (estimateMode.value) {
      props.exitEstimate = {
        onClick: exitEstimate,
        title: "Back to analysis",
      };
    } else {
      props.pass = {
        onClick: () => {
          board.value?.pass();
        },
      };
      props.exitAnalysis = { onClick: exitAnalysis };
      props.estimate = { onClick: enterEstimate };
      props.sgfExport = { onClick: handleSgfExport };
    }
  } else if (estimateMode.value) {
    props.exitEstimate = { onClick: exitEstimate };
  } else {
    // Live mode
    if (isPlayerVal && isPlay) {
      props.pass = {
        onClick: () => {},
        disabled: !isMyTurn,
      };
      props.confirmPass = {
        message: "Pass your turn?",
        onConfirm: () => channel.pass(),
      };
    }

    if (isPlay) {
      props.resign = {
        message: "Resign this game?",
        onConfirm: () => channel.resign(),
      };
    }

    if (isPlayerVal && allowUndo.value && isPlay) {
      const canUndo =
        moves.value.length > 0 && !isMyTurn && !undoRejected.value;
      props.requestUndo = {
        onClick: () => channel.requestUndo(),
        disabled: !canUndo,
        title: undoRejected.value
          ? "Undo was rejected for this move"
          : moves.value.length === 0
            ? "No moves to undo"
            : isMyTurn
              ? "Cannot undo on your turn"
              : "Request to undo your last move",
      };
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

    const canAbort =
      isPlayerVal && moves.value.length === 0 && !result.value;
    if (canAbort) {
      props.abort = {
        message: "Abort this game?",
        onConfirm: () => channel.abort(),
      };
    }

    if (!isReview) {
      props.analyze = { onClick: enterAnalysis };
    }

    if (isPlay && !isReview) {
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
      };
    }
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
      extra={
        errorMessage.value ? (
          <div class="game-error">{errorMessage.value}</div>
        ) : undefined
      }
    />
  );
}
