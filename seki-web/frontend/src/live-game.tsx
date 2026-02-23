import { render, createRef } from "preact";
import {
  GameStage,
  isPlayStage,
  type InitialGameProps,
  type Point,
  type ScoreData,
  type Sign,
  type SettledTerritoryData,
} from "./goban/types";
import { createBoard, type TerritoryOverlay } from "./board";
import { Chat, type ChatEntry } from "./chat";
import { readShowCoordinates } from "./coord-toggle";
import { createPremove } from "./premove";
import type { ControlsProps } from "./controls";
import { settingsToSgfTime, formatResult, formatPoints } from "./format";
import { IconCheck, IconX } from "./icons";
import { joinGame } from "./live";
import { createGameContext } from "./game-context";
import { createGameChannel } from "./game-channel";
import { formatScoreStr, updateTurnFlash, updateTitle } from "./game-ui";
import type { TerritoryCountdown } from "./game-ui";
import { handleGameMessage } from "./game-messages";
import type { ClockState } from "./game-clock";
import { computeClockDisplay } from "./game-clock";
import { readUserData, derivePlayerStone } from "./game-util";
import { createNotificationState } from "./game-notifications";
import { playStoneSound, playPassSound } from "./game-sound";
import { downloadSgf } from "./sgf-io";
import type { SgfMeta } from "./sgf-io";
import { GamePageLayout } from "./game-page-layout";
import type { GamePageLayoutProps } from "./game-page-layout";
import { GameDescription } from "./game-description";
import {
  buildNavProps,
  buildCoordsToggle,
  buildMoveConfirmToggle,
} from "./shared-controls";
import type { CoordsToggleState } from "./shared-controls";
import type { PlayerPanelProps } from "./player-panel";

export function liveGame(
  initialProps: InitialGameProps,
  gameId: number,
  root: HTMLElement,
) {
  const userData = readUserData();
  const playerStone = derivePlayerStone(
    userData,
    initialProps.black,
    initialProps.white,
  );

  console.debug("InitialGameProps", initialProps);
  console.debug("UserData", userData, "playerStone", playerStone);

  const ctx = createGameContext(gameId, playerStone, initialProps);
  const channel = createGameChannel(gameId);
  const gobanRef = createRef<HTMLDivElement>();
  const clockState: ClockState = {
    data: undefined,
    syncedAt: 0,
    interval: undefined,
    timeoutFlagSent: false,
  };
  const territoryCountdown: TerritoryCountdown = {
    deadline: undefined,
    interval: undefined,
    flagSent: false,
    chatEntry: undefined,
  };

  const coordsState: CoordsToggleState = {
    showCoordinates: readShowCoordinates(),
  };

  const pm = createPremove({
    getSign: () => ctx.playerStone as Sign,
  });

  // --- Ghost stone getter ---
  function ghostStone() {
    if (ctx.analysisMode || ctx.estimateMode) {
      return undefined;
    }
    return pm.getGhostStone();
  }

  // --- Server territory overlay getter ---
  function getServerTerritory(): TerritoryOverlay | undefined {
    // Active territory review
    if (ctx.gameStage === GameStage.TerritoryReview && ctx.territory) {
      const paintMap = ctx.territory.ownership.map((v) => (v === 0 ? null : v));
      const dimmedVertices: Point[] = ctx.territory.dead_stones.map(
        ([c, r]) => [c, r] as Point,
      );
      return { paintMap, dimmedVertices };
    }
    // Settled territory overlay for finished games
    if (ctx.estimateMode && ctx.settledTerritory) {
      return buildSettledOverlay(ctx.settledTerritory);
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

  // --- Move tree ---
  let showMoveTree = false;
  const moveTreeEl = document.createElement("div");
  moveTreeEl.className = "move-tree";

  function setMoveTree(visible: boolean) {
    showMoveTree = visible;
    if (visible) {
      ctx.board?.setMoveTreeEl(moveTreeEl);
    } else {
      ctx.board?.setMoveTreeEl(null);
    }
    ctx.board?.render();
  }

  // --- Analysis helpers ---
  function enterAnalysis() {
    pm.clear();
    ctx.analysisMode = true;
    setMoveTree(true);
    doRender();
  }

  function exitAnalysis() {
    pm.clear();
    ctx.analysisMode = false;
    setMoveTree(false);
    if (ctx.board) {
      ctx.board.updateBaseMoves(JSON.stringify(ctx.moves));
      ctx.board.render();
    }
    doRender();
  }

  // --- Estimate helpers ---
  let estimateScore: ScoreData | undefined;

  function enterEstimate() {
    pm.clear();
    ctx.estimateMode = true;
    if (ctx.settledTerritory) {
      // Static overlay for finished games — just toggle and re-render
      ctx.board?.render();
      doRender();
    } else {
      ctx.board?.enterTerritoryReview();
    }
  }

  function exitEstimate() {
    ctx.estimateMode = false;
    estimateScore = undefined;
    if (ctx.settledTerritory) {
      ctx.board?.render();
      doRender();
    } else {
      ctx.board?.exitTerritoryReview();
      doRender();
    }
  }

  // --- Vertex click handler ---
  function handleVertexClick(col: number, row: number): boolean {
    if (ctx.analysisMode) {
      return false;
    }
    if (!ctx.board || !ctx.board.engine.is_at_latest()) {
      return true;
    }
    if (ctx.playerStone === 0) {
      return true;
    }
    if (ctx.gameStage === GameStage.TerritoryReview) {
      channel.toggleChain(col, row);
      return true;
    }
    const isMyTurn = ctx.currentTurn === ctx.playerStone;
    if (isMyTurn) {
      if (!pm.enabled) {
        pm.clear();
        channel.play(col, row);
      } else if (pm.value && pm.value[0] === col && pm.value[1] === row) {
        pm.clear();
        channel.play(col, row);
      } else {
        pm.value = [col, row];
        ctx.board.render();
        doRender();
      }
    }
    return true;
  }

  // --- SGF export ---
  function handleSgfExport() {
    if (!ctx.board) {
      return;
    }
    const timeFields = settingsToSgfTime(initialProps.settings);
    const meta: SgfMeta = {
      cols: ctx.gameState.cols,
      rows: ctx.gameState.rows,
      komi: initialProps.komi,
      handicap: initialProps.settings.handicap || undefined,
      black_name: ctx.black?.display_name,
      white_name: ctx.white?.display_name,
      result: ctx.result ?? undefined,
      game_name: undefined,
      time_limit_secs: timeFields.time_limit_secs,
      overtime: timeFields.overtime,
    };
    const sgf = ctx.board.engine.export_sgf(JSON.stringify(meta));
    const bName = ctx.black?.display_name ?? "Black";
    const wName = ctx.white?.display_name ?? "White";
    downloadSgf(sgf, `${bName}-vs-${wName}.sgf`);
  }

  // --- Parse initial chat history ---
  const chatLogRaw = root.dataset.chatLog;
  if (chatLogRaw) {
    ctx.chatMessages = JSON.parse(chatLogRaw) as ChatEntry[];
  }

  // --- Build player panel props ---
  function buildPlayerPanelProps(): {
    top: PlayerPanelProps;
    bottom: PlayerPanelProps;
  } {
    const { black, white } = ctx;
    const bName = black ? black.display_name : "…";
    const wName = white ? white.display_name : "…";
    const bUrl = black ? `/users/${black.display_name}` : undefined;
    const wUrl = white ? `/users/${white.display_name}` : undefined;
    const bOnline = black ? ctx.onlineUsers.has(black.id) : false;
    const wOnline = white ? ctx.onlineUsers.has(white.id) : false;
    const bTurn = ctx.gameStage === GameStage.BlackToPlay;
    const wTurn = ctx.gameStage === GameStage.WhiteToPlay;

    const score =
      estimateScore ?? ctx.territory?.score ?? ctx.settledTerritory?.score;
    const komi = ctx.initialProps.komi;

    let bStr: string;
    let wStr: string;
    if (score) {
      ({ bStr, wStr } = formatScoreStr(score, komi));
    } else {
      ({ bStr, wStr } = formatPoints(
        ctx.gameState.captures.black,
        ctx.gameState.captures.white,
        komi,
      ));
    }

    let bClock: string | undefined;
    let wClock: string | undefined;
    let bClockLow = false;
    let wClockLow = false;
    const cd = computeClockDisplay(clockState);
    bClock = cd.blackText || undefined;
    wClock = cd.whiteText || undefined;
    bClockLow = cd.blackLow;
    wClockLow = cd.whiteLow;

    const blackPanel: PlayerPanelProps = {
      name: bName,
      captures: bStr,
      stone: "black",
      clock: bClock,
      clockLowTime: bClockLow,
      profileUrl: bUrl,
      isOnline: bOnline,
      isTurn: bTurn,
    };
    const whitePanel: PlayerPanelProps = {
      name: wName,
      captures: wStr,
      stone: "white",
      clock: wClock,
      clockLowTime: wClockLow,
      profileUrl: wUrl,
      isOnline: wOnline,
      isTurn: wTurn,
    };

    if (ctx.playerStone === -1) {
      return { top: blackPanel, bottom: whitePanel };
    }
    return { top: whitePanel, bottom: blackPanel };
  }

  // --- Build controls props ---
  function buildControls(): ControlsProps {
    const isPlay = isPlayStage(ctx.gameStage);
    const isReview = ctx.gameStage === GameStage.TerritoryReview;
    const isMyTurn = ctx.currentTurn === ctx.playerStone;
    const isPlayer = ctx.playerStone !== 0;

    const nav = buildNavProps(ctx.board);

    // Show result in nav counter when available
    let resultStr: string | undefined;
    if (estimateScore) {
      resultStr = formatResult(estimateScore, ctx.initialProps.komi);
    } else if (isReview && ctx.territory?.score) {
      resultStr = formatResult(ctx.territory.score, ctx.initialProps.komi);
    } else if (ctx.result && ctx.board?.engine.is_at_latest()) {
      resultStr = ctx.result;
    }
    if (resultStr) {
      nav.counter = `${nav.counter} (${resultStr})`;
    }

    const props: ControlsProps = {
      nav,
      coordsToggle: buildCoordsToggle(ctx.board, coordsState),
      moveConfirmToggle: buildMoveConfirmToggle(pm, ctx.board),
      moveTreeToggle: {
        enabled: showMoveTree,
        onClick: () => {
          setMoveTree(!showMoveTree);
          doRender();
        },
      },
    };

    if (ctx.analysisMode) {
      if (ctx.estimateMode) {
        props.exitEstimate = {
          onClick: exitEstimate,
          title: "Back to analysis",
        };
      } else {
        props.pass = {
          onClick: () => {
            ctx.board?.pass();
          },
        };
        props.exitAnalysis = { onClick: exitAnalysis };
        props.estimate = { onClick: enterEstimate };
        props.sgfExport = { onClick: handleSgfExport };
      }
    } else if (ctx.estimateMode) {
      props.exitEstimate = { onClick: exitEstimate };
    } else {
      // Live mode
      if (isPlayer && isPlay) {
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

      if (isPlayer && ctx.allowUndo && isPlay) {
        const canUndo = ctx.moves.length > 0 && !isMyTurn && !ctx.undoRejected;
        props.requestUndo = {
          onClick: () => channel.requestUndo(),
          disabled: !canUndo,
          title: ctx.undoRejected
            ? "Undo was rejected for this move"
            : ctx.moves.length === 0
              ? "No moves to undo"
              : isMyTurn
                ? "Cannot undo on your turn"
                : "Request to undo your last move",
        };
      }

      if (isReview && isPlayer) {
        const alreadyApproved =
          (ctx.playerStone === 1 && ctx.territory?.black_approved) ||
          (ctx.playerStone === -1 && ctx.territory?.white_approved);
        props.acceptTerritory = {
          message: "Accept territory?",
          onConfirm: () => channel.approveTerritory(),
          disabled: !!alreadyApproved,
        };
      }

      const canAbort = isPlayer && ctx.moves.length === 0 && !ctx.result;
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
      } else if (ctx.result && ctx.settledTerritory) {
        props.estimate = { onClick: enterEstimate, title: "Show territory" };
      }
    }

    // Confirm move button
    if (pm.value && isMyTurn && !ctx.analysisMode) {
      props.confirmMove = {
        onClick: () => {
          if (pm.value) {
            const [col, row] = pm.value;
            pm.clear();
            channel.play(col, row);
            doRender();
          }
        },
      };
    }

    return props;
  }

  // --- Build title props ---
  function buildTitleProps() {
    return {
      id: ctx.gameId,
      creator_id: ctx.initialProps.creator_id,
      black: ctx.black,
      white: ctx.white,
      settings: ctx.initialProps.settings,
      stage: ctx.gameStage,
      result: ctx.result ?? undefined,
      move_count: ctx.moves.length > 0 ? ctx.moves.length : undefined,
    };
  }

  // --- Single render function ---
  function doRender() {
    const panels = buildPlayerPanelProps();
    const titleProps = buildTitleProps();

    const header = (
      <h2>
        <GameDescription {...titleProps} />
      </h2>
    );

    const sidebar = (
      <>
        <div class="chat">
          <Chat
            messages={ctx.chatMessages}
            onlineUsers={ctx.onlineUsers}
            black={ctx.black}
            white={ctx.white}
            onSend={(text) => channel.say(text)}
          />
        </div>
        {showMoveTree && (
          <div
            ref={(el) => {
              if (el && !el.contains(moveTreeEl)) {
                el.appendChild(moveTreeEl);
              }
            }}
          />
        )}
      </>
    );

    const extra = (
      <>
        {ctx.undoResponseNeeded && ctx.playerStone !== 0 && (
          <div class="undo-response-controls">
            <p>Opponent has requested to undo their last move.</p>
            <button
              class="confirm-yes"
              onClick={() => {
                ctx.undoResponseNeeded = false;
                channel.acceptUndo();
                doRender();
              }}
            >
              <IconCheck />
            </button>
            <button
              class="confirm-no"
              onClick={() => {
                ctx.undoResponseNeeded = false;
                channel.rejectUndo();
                doRender();
              }}
            >
              <IconX />
            </button>
          </div>
        )}
        {ctx.errorMessage && <div class="game-error">{ctx.errorMessage}</div>}
      </>
    );

    const props: GamePageLayoutProps = {
      header,
      gobanRef,
      gobanStyle: `aspect-ratio: ${ctx.gameState.cols}/${ctx.gameState.rows}`,
      gobanClass: ctx.analysisMode ? "goban-analysis" : undefined,
      playerTop: panels.top,
      playerBottom: panels.bottom,
      controls: buildControls(),
      sidebar,
      extra,
    };

    render(<GamePageLayout {...props} />, root);

    updateTitle(ctx);
  }

  // --- WASM board (async) ---
  // Render layout first so the goban div exists
  doRender();

  createBoard({
    cols: ctx.gameState.cols,
    rows: ctx.gameState.rows,
    handicap: initialProps.settings.handicap,
    showCoordinates: coordsState.showCoordinates,
    gobanEl: gobanRef.current!,
    ghostStone,
    territoryOverlay: getServerTerritory,
    onVertexClick: (col, row) => handleVertexClick(col, row),
    onStonePlay: playStoneSound,
    onPass: playPassSound,
    onRender: (engine, territory) => {
      // Auto-exit estimate when territory review gets cleared (e.g. by navigation)
      // Don't auto-exit for settled territory (static overlay, not WASM-driven)
      if (ctx.estimateMode && !territory.reviewing && !ctx.settledTerritory) {
        ctx.estimateMode = false;
        estimateScore = undefined;
      }

      // Capture estimate score for status display
      if (ctx.estimateMode && territory.score) {
        estimateScore = territory.score;
      }

      // Auto-enter analysis when navigating away from latest game move.
      if (
        ctx.board &&
        !ctx.analysisMode &&
        !ctx.estimateMode &&
        engine.view_index() < ctx.moves.length
      ) {
        enterAnalysis();
      }
      doRender();
    },
  }).then((b) => {
    ctx.board = b;
    // Sync any moves that arrived from WS while board was loading
    if (ctx.moves.length > 0) {
      ctx.movesJson = JSON.stringify(ctx.moves);
      ctx.board.updateBaseMoves(ctx.movesJson);
    }
    ctx.board.render();
    ctx.board.updateNav();
    doRender();
  });

  // --- Notifications ---
  const notificationState = createNotificationState();

  // --- WebSocket ---
  const deps = {
    ctx,
    gobanEl: () => gobanRef.current,
    clockState,
    territoryCountdown,
    channel,
    premove: pm,
    notificationState,
    rerender: doRender,
    onNewMove: () => {
      if (ctx.analysisMode) {
        exitAnalysis();
      }
      if (ctx.estimateMode) {
        exitEstimate();
      }
    },
  };
  joinGame(gameId, (raw) => handleGameMessage(raw, deps));

  // --- Tab title flash ---
  document.addEventListener("visibilitychange", () => updateTurnFlash(ctx));
}
