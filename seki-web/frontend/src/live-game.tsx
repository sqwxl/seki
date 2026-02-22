import { GameStage, isPlayStage, type InitialGameProps, type Point, type Sign } from "./goban/types";
import { createBoard, type TerritoryOverlay } from "./board";
import { renderChatHistory, setupChat, type SenderResolver } from "./chat";
import { readShowCoordinates, toggleShowCoordinates } from "./coord-toggle";
import { createPremove } from "./premove";
import { renderControls } from "./controls";
import type { ControlsProps } from "./controls";
import { blackSymbol, whiteSymbol } from "./format";
import { setIcon, checkSvg, xSvg } from "./icons";
import { joinGame } from "./live";
import { createGameContext } from "./game-context";
import { createGameChannel } from "./game-channel";
import { queryGameDom } from "./game-dom";
import { updateTitle, renderPlayerLabels, updateStatus, updateTurnFlash } from "./game-ui";
import type { TerritoryCountdown } from "./game-ui";
import { handleGameMessage } from "./game-messages";
import type { ClockState } from "./game-clock";
import { readUserData, derivePlayerStone } from "./game-util";
import { playStoneSound, playPassSound } from "./game-sound";
import { settingsToSgfTime } from "./format";
import { downloadSgf } from "./sgf-io";
import type { SgfMeta } from "./sgf-io";

export function liveGame(initialProps: InitialGameProps, gameId: number) {
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
  const dom = queryGameDom();
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
  };

  let showCoordinates = readShowCoordinates();

  const pm = createPremove({
    getSign: () => ctx.playerStone as Sign,
  });

  // --- Ghost stone getter ---
  function ghostStone() {
    if (ctx.analysisMode) {
      return undefined;
    }
    return pm.getGhostStone();
  }

  // --- Server territory overlay getter ---
  function getServerTerritory(): TerritoryOverlay | undefined {
    if (ctx.gameStage !== GameStage.TerritoryReview || !ctx.territory) {
      return undefined;
    }
    const paintMap = ctx.territory.ownership.map((v) => (v === 0 ? null : v));
    const dimmedVertices: Point[] = ctx.territory.dead_stones.map(
      ([c, r]) => [c, r] as Point,
    );
    return { paintMap, dimmedVertices };
  }

  // --- Controls rendering ---
  function doRenderControls() {
    if (!dom.controls) {
      return;
    }

    const isPlay = isPlayStage(ctx.gameStage);
    const isReview = ctx.gameStage === GameStage.TerritoryReview;
    const isMyTurn = ctx.currentTurn === ctx.playerStone;
    const isPlayer = ctx.playerStone !== 0;

    const props: ControlsProps = {
      nav: {
        atStart: ctx.board?.engine.is_at_start() ?? true,
        atLatest: ctx.board?.engine.is_at_latest() ?? true,
        counter: ctx.board
          ? `${ctx.board.engine.view_index()} / ${ctx.board.engine.total_moves()}`
          : "0 / 0",
        onNavigate: (action) => ctx.board?.navigate(action),
      },
      coordsToggle: {
        enabled: showCoordinates,
        onClick: () => {
          showCoordinates = toggleShowCoordinates();
          ctx.board?.setShowCoordinates(showCoordinates);
        },
      },
      moveConfirmToggle: {
        enabled: pm.enabled,
        onClick: () => {
          pm.enabled = !pm.enabled;
          pm.clear();
          ctx.board?.render();
        },
      },
      sgfExport: { onClick: handleSgfExport },
    };

    if (ctx.analysisMode) {
      // Analysis mode: show pass (local) and exit button
      props.pass = {
        onClick: () => { ctx.board?.pass(); },
      };
      props.exitAnalysis = { onClick: exitAnalysis };
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
        const canUndo =
          ctx.moves.length > 0 &&
          !isMyTurn &&
          !ctx.undoRejected;
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
    }

    // Confirm move button
    if (pm.value && isMyTurn && !ctx.analysisMode) {
      props.confirmMove = {
        onClick: () => {
          if (pm.value) {
            const [col, row] = pm.value;
            pm.clear();
            channel.play(col, row);
            doRenderControls();
          }
        },
      };
    }

    renderControls(dom.controls, props);
  }

  // --- WASM board (async) ---
  createBoard({
    cols: ctx.gameState.cols,
    rows: ctx.gameState.rows,
    handicap: initialProps.settings.handicap,
    showCoordinates,
    gobanEl: dom.goban,
    ghostStone,
    territoryOverlay: getServerTerritory,
    onVertexClick: (col, row) => handleVertexClick(col, row),
    onStonePlay: playStoneSound,
    onPass: playPassSound,
    onRender: (engine) => {
      // Auto-enter analysis when navigating away from latest game move.
      // Guard on ctx.board to skip the initial render inside createBoard(),
      // where the engine has no moves yet but ctx.moves may already be
      // populated from a WS message that arrived during WASM loading.
      if (ctx.board && !ctx.analysisMode && engine.view_index() < ctx.moves.length) {
        enterAnalysis();
      }
      doRenderControls();
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
    doRenderControls();
  });

  // --- Analysis helpers ---
  function enterAnalysis() {
    pm.clear();
    ctx.analysisMode = true;
    dom.goban.classList.add("goban-analysis");
    doRenderControls();
    if (ctx.board) {
      ctx.board.render();
    }
  }

  function exitAnalysis() {
    pm.clear();
    ctx.analysisMode = false;
    dom.goban.classList.remove("goban-analysis");
    if (ctx.board) {
      ctx.board.updateBaseMoves(JSON.stringify(ctx.moves));
      ctx.board.render();
    }
    doRenderControls();
  }

  function handleVertexClick(col: number, row: number): boolean {
    // In analysis mode, let the board handle clicks (local play)
    if (ctx.analysisMode) {
      return false;
    }
    // In live mode, always consume clicks — never fall through to local play
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
        // Confirm: same position clicked twice
        pm.clear();
        channel.play(col, row);
      } else {
        // Show ghost stone at clicked position
        pm.value = [col, row];
        ctx.board.render();
        doRenderControls();
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

  // --- Chat sender resolver ---
  const resolveSender: SenderResolver = (userId) => {
    if (userId == null) {
      return "⚑";
    }
    const isBlack = ctx.black?.id === userId;
    const isWhite = ctx.white?.id === userId;
    const name = (isBlack ? ctx.black : isWhite ? ctx.white : undefined)
      ?.display_name ?? "?";
    const symbol = isBlack ? blackSymbol() : isWhite ? whiteSymbol() : "?";
    return `${name} ${symbol}`;
  };

  // --- Render labels closure ---
  const renderLabels = () => renderPlayerLabels(ctx, dom.playerTop, dom.playerBottom, clockState);

  // --- WebSocket ---
  const deps = {
    ctx, dom, clockState, territoryCountdown, channel, resolveSender, renderLabels,
    premove: pm,
    renderControls: doRenderControls,
    onNewMove: () => {
      if (ctx.analysisMode) {
        exitAnalysis();
      }
    },
  };
  joinGame(gameId, (raw) => handleGameMessage(raw, deps));

  // --- Undo response popover (outside Controls — kept in template) ---
  setIcon("accept-undo-btn", checkSvg);
  setIcon("reject-undo-btn", xSvg);
  document
    .getElementById("accept-undo-btn")
    ?.addEventListener("click", () => channel.acceptUndo());
  document
    .getElementById("reject-undo-btn")
    ?.addEventListener("click", () => channel.rejectUndo());

  // --- Tab title flash ---
  document.addEventListener("visibilitychange", () => updateTurnFlash(ctx));

  // --- Initial render ---
  updateTitle(ctx, dom.title);
  renderLabels();
  updateStatus(ctx, dom.status);
  doRenderControls();

  renderChatHistory(resolveSender);
  setupChat((text) => channel.say(text));
}
