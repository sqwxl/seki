import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { analyzePositionDirect } from "../ai/analyze";
import {
  ghostStoneMapFromRootMoves,
  heatMapFromRootMoves,
} from "../ai/heatmap";
import { aiPositionFromEngine } from "../ai/position";
import { GameControls } from "../components/game-controls";
import { GameStatus } from "../components/game-status";
import {
  IconBot,
  IconSpinner,
  StoneBlack,
  StoneWhite,
} from "../components/icons";
import { UIControls } from "../components/ui-controls";
import { UserLabel } from "../components/user-label";
import { playPassSound, playStoneSound } from "../game/sound";
import { GameStage, UserData } from "../game/types";
import { readUserData } from "../game/util";
import { createBoard, ensureWasm, type Board } from "../goban/create-board";
import type { GhostStoneData, HeatData, Sign } from "../goban/types";
import { readShowCoordinates } from "../utils/coord-toggle";
import { useMediaQuery } from "../utils/media-query";
import { storage } from "../utils/storage";
import { ColorPickerField, SettingsFieldset } from "./form-variants/shared";
import { GamePageLayout } from "./game-page-layout";

type StoneChoice = 1 | -1;
type BotSettings = {
  color: "black" | "white";
  hints: boolean;
  takebacks: boolean;
};
type BotStoredState = {
  started: boolean;
  settings: BotSettings;
};

const BOARD_SIZE = 9;
const KOMI = 6.5;
const BOT_STATE_KEY = "seki:bot:state";
const BOT_TREE_KEY = "seki:bot:tree";

const DEFAULT_SETTINGS: BotSettings = {
  color: "black",
  hints: true,
  takebacks: true,
};

function normalizeBotSettings(
  settings: Partial<BotSettings> & { humanStone?: StoneChoice },
): BotSettings {
  if (settings.color === "black" || settings.color === "white") {
    return {
      color: settings.color,
      hints: settings.hints ?? DEFAULT_SETTINGS.hints,
      takebacks: settings.takebacks ?? DEFAULT_SETTINGS.takebacks,
    };
  }

  return {
    color: settings.humanStone === -1 ? "white" : "black",
    hints: settings.hints ?? DEFAULT_SETTINGS.hints,
    takebacks: settings.takebacks ?? DEFAULT_SETTINGS.takebacks,
  };
}

export function initBot(root: HTMLElement) {
  render(<BotPracticeScreen />, root);

  return () => render(null, root);
}

function readBotState(): BotStoredState {
  const saved = storage.getJson<
    BotStoredState & {
      settings?: Partial<BotSettings> & { humanStone?: StoneChoice };
    }
  >(BOT_STATE_KEY);

  if (!saved) {
    return {
      started: false,
      settings: DEFAULT_SETTINGS,
    };
  }

  return {
    started: saved.started ?? false,
    settings: normalizeBotSettings(saved.settings ?? {}),
  };
}

function writeBotState(state: BotStoredState) {
  storage.setJson(BOT_STATE_KEY, state);
}

function clearBotTree() {
  storage.remove(BOT_TREE_KEY);
  storage.remove(`${BOT_TREE_KEY}:base`);
  storage.remove(`${BOT_TREE_KEY}:finalized`);
  storage.remove(`${BOT_TREE_KEY}:node`);
}

function BotPracticeScreen() {
  const [storedState, setStoredState] = useState(readBotState);

  if (!storedState.started) {
    return (
      <BotSetupForm
        initial={storedState.settings}
        onStart={(settings) => {
          clearBotTree();
          const next = { started: true, settings };

          writeBotState(next);
          setStoredState(next);
        }}
      />
    );
  }

  return (
    <BotGame
      settings={storedState.settings}
      onNewGame={() => {
        clearBotTree();
        const next = { started: false, settings: storedState.settings };

        writeBotState(next);
        setStoredState(next);
      }}
    />
  );
}

function BotSetupForm({
  initial,
  onStart,
}: {
  initial: BotSettings;
  onStart: (settings: BotSettings) => void;
}) {
  const [color, setColor] = useState<BotSettings["color"]>(initial.color);
  const [hints, setHints] = useState(initial.hints);
  const [takebacks, setTakebacks] = useState(initial.takebacks);
  const colorPickerState = {
    ranked: false,
    cols: BOARD_SIZE,
    handicap: 0,
    komi: KOMI,
    color,
    allowUndo: takebacks,
    isPrivate: false,
  };

  function submit(event: Event) {
    event.preventDefault();
    onStart({ color, hints, takebacks });
  }

  return (
    <form onSubmit={submit}>
      <div>
        <SettingsFieldset>
          <ColorPickerField
            s={colorPickerState}
            set={(_, value) => setColor(value as BotSettings["color"])}
            label="Your color"
            value={color}
          />
          <div>
            <label>Board size</label>
            <p class="form-help">Locked to 9x9 for now.</p>
            <select value="9" disabled>
              <option value="9">9x9</option>
            </select>
          </div>
          <div>
            <label>Bot strength</label>
            <p class="form-help">Locked to direct policy for now.</p>
            <select value="direct" disabled>
              <option value="direct">Direct policy</option>
            </select>
          </div>
          <label>
            <input
              type="checkbox"
              checked={hints}
              onChange={(event) => setHints(event.currentTarget.checked)}
            />
            Hints?
          </label>
          <label>
            <input
              type="checkbox"
              checked={takebacks}
              onChange={(event) => setTakebacks(event.currentTarget.checked)}
            />
            Takebacks?
          </label>
        </SettingsFieldset>
      </div>
      <div class="form-actions">
        <button type="submit">Start game</button>
      </div>
    </form>
  );
}

function BotGame({
  settings,
  onNewGame,
}: {
  settings: BotSettings;
  onNewGame: () => void;
}) {
  const gobanRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<Board | undefined>(undefined);
  const requestIdRef = useRef(0);
  const botThinkingRef = useRef(false);
  const suppressBotRef = useRef(false);
  const applyingBotMoveRef = useRef(false);
  const humanStoneRef = useRef<StoneChoice>(
    settings.color === "black" ? 1 : -1,
  );
  const hintHeatRef = useRef<(HeatData | null)[] | undefined>(undefined);
  const hintGhostRef = useRef<(GhostStoneData | null)[] | undefined>(undefined);

  const [botThinking, setBotThinking] = useState(false);
  const [status, setStatus] = useState("Loading board");
  const [error, setError] = useState<string | undefined>(undefined);
  const [canHumanAct, setCanHumanAct] = useState(false);
  const [currentTurn, setCurrentTurn] = useState<StoneChoice>(1);
  const [aiSuggestPending, setAiSuggestPending] = useState(false);
  const [aiSuggestActive, setAiSuggestActive] = useState(false);
  const [estimateActive, setEstimateActive] = useState(false);

  const humanStone = settings.color === "black" ? 1 : -1;

  humanStoneRef.current = humanStone;
  botThinkingRef.current = botThinking;

  const [user] = useState<UserData | undefined>(() => readUserData());

  useEffect(() => {
    let disposed = false;
    const requestIdBase = ++requestIdRef.current;

    async function initBoard() {
      const gobanEl = gobanRef.current;

      boardRef.current?.destroy();
      boardRef.current = undefined;
      setError(undefined);
      setStatus("Loading board");
      setCanHumanAct(false);
      clearHintOverlay(false, false);

      await ensureWasm();

      if (!gobanEl || disposed || requestIdRef.current !== requestIdBase) {
        return;
      }

      const board = await createBoard({
        cols: BOARD_SIZE,
        rows: BOARD_SIZE,
        gobanEl,
        storageKey: BOT_TREE_KEY,
        komi: KOMI,
        showCoordinates: readShowCoordinates(),
        canPlay: () => canHumanPlay(),
        ghostStoneOverlay: () => hintGhostRef.current,
        heatOverlay: () => hintHeatRef.current,
        onStonePlay: () => {
          playStoneSound();
          clearHintOverlay(false, !applyingBotMoveRef.current);
          setEstimateActive(false);
          setError(undefined);
        },
        onPass: () => {
          playPassSound();
          clearHintOverlay(false, !applyingBotMoveRef.current);
          setEstimateActive(false);
          setError(undefined);
        },
        onNavigate: () => clearHintOverlay(false, true),
        onRender: () => {
          syncUi();
          maybeRequestBotMove();
        },
      });

      if (disposed || requestIdRef.current !== requestIdBase) {
        board.destroy();
        return;
      }

      boardRef.current = board;
      syncUi();
      maybeRequestBotMove();
    }

    function canHumanPlay() {
      const board = boardRef.current;

      return (
        !!board &&
        !botThinkingRef.current &&
        !suppressBotRef.current &&
        board.engine.stage() !== GameStage.TerritoryReview &&
        board.engine.stage() !== GameStage.Completed &&
        board.engine.current_turn_stone() === humanStoneRef.current
      );
    }

    function syncUi() {
      const board = boardRef.current;

      if (!board) {
        return;
      }

      const stage = board.engine.stage();
      const turn = board.engine.current_turn_stone() as StoneChoice;

      setCurrentTurn(turn);
      setCanHumanAct(canHumanPlay());

      if (stage === GameStage.TerritoryReview) {
        setStatus("Territory review");
      } else if (stage === GameStage.Completed) {
        setStatus("Game complete");
      } else if (turn === humanStoneRef.current) {
        setStatus("Your turn");
      } else {
        setStatus(botThinkingRef.current ? "Bot thinking" : "Bot to play");
      }
    }

    async function maybeRequestBotMove() {
      const board = boardRef.current;

      if (
        !board ||
        disposed ||
        suppressBotRef.current ||
        botThinkingRef.current ||
        board.engine.stage() === GameStage.TerritoryReview ||
        board.engine.stage() === GameStage.Completed ||
        board.engine.current_turn_stone() === humanStoneRef.current
      ) {
        return;
      }

      const requestId = ++requestIdRef.current;
      botThinkingRef.current = true;
      setBotThinking(true);
      setStatus("Bot thinking");
      setError(undefined);

      try {
        const result = await analyzePositionDirect(
          aiPositionFromEngine(board.engine, KOMI),
        );

        if (
          disposed ||
          requestId !== requestIdRef.current ||
          boardRef.current !== board
        ) {
          return;
        }

        const move = result.analysis.rootMoves[0]?.action;

        applyingBotMoveRef.current = true;
        try {
          if (!move || move.kind === "pass") {
            board.pass();
          } else if (!board.playMove(move.col, move.row)) {
            throw new Error("Bot selected an illegal move");
          }
        } finally {
          applyingBotMoveRef.current = false;
        }
      } catch (err) {
        if (!disposed && requestId === requestIdRef.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!disposed && requestId === requestIdRef.current) {
          botThinkingRef.current = false;
          setBotThinking(false);
          syncUi();
        }
      }
    }

    void initBoard();

    return () => {
      disposed = true;
      requestIdRef.current += 1;
      boardRef.current?.destroy();
      boardRef.current = undefined;
    };
  }, [settings.color, settings.hints, settings.takebacks]);

  function clearHintOverlay(renderBoard = true, cancelRequests = true) {
    if (cancelRequests) {
      requestIdRef.current += 1;
    }
    hintHeatRef.current = undefined;
    hintGhostRef.current = undefined;
    setAiSuggestActive(false);
    setAiSuggestPending(false);

    if (renderBoard) {
      boardRef.current?.renderBoardOnly();
    }
  }

  async function showAiSuggestion() {
    const board = boardRef.current;

    if (!board || aiSuggestPending) {
      return;
    }

    if (aiSuggestActive) {
      clearHintOverlay();
      return;
    }

    const requestId = ++requestIdRef.current;
    setAiSuggestPending(true);
    setError(undefined);

    try {
      const result = await analyzePositionDirect(
        aiPositionFromEngine(board.engine, KOMI),
      );

      if (requestId !== requestIdRef.current || boardRef.current !== board) {
        return;
      }

      const sign = board.engine.current_turn_stone() as Sign;

      hintHeatRef.current = heatMapFromRootMoves(
        result.analysis.rootMoves,
        BOARD_SIZE,
      );
      hintGhostRef.current = ghostStoneMapFromRootMoves(
        result.analysis.rootMoves,
        BOARD_SIZE,
        sign,
      );
      setAiSuggestActive(true);
      board.renderBoardOnly();
    } catch (err) {
      if (requestId === requestIdRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setAiSuggestPending(false);
      }
    }
  }

  function toggleEstimate() {
    const board = boardRef.current;

    if (!board) {
      return;
    }

    clearHintOverlay(false, true);

    if (estimateActive) {
      board.exitTerritoryReview();
      setEstimateActive(false);
    } else {
      board.enterEstimate();
      setEstimateActive(true);
    }
  }

  function pass() {
    if (canHumanAct && boardRef.current?.pass()) {
      setEstimateActive(false);
    }
  }

  function undo() {
    const board = boardRef.current;

    if (!board || !settings.takebacks || botThinking) {
      return;
    }

    suppressBotRef.current = true;
    clearHintOverlay(false, true);
    setEstimateActive(false);

    let changed = false;

    if (board.engine.view_index() < 2) {
      suppressBotRef.current = false;
      return;
    }

    do {
      changed = board.undoMove() || changed;
    } while (
      board.engine.view_index() > 0 &&
      board.engine.current_turn_stone() !== humanStone
    );

    suppressBotRef.current = false;

    if (changed) {
      board.render();
    }
  }

  function resign() {
    requestIdRef.current += 1;
    suppressBotRef.current = true;
    botThinkingRef.current = false;
    setBotThinking(false);
    setStatus("You resigned");
    setCanHumanAct(false);
    setError(undefined);
  }

  const compact = useMediaQuery("(max-width: 767px)");
  const controls = {
    nav: {
      atStart: true,
      atLatest: true,
      atMainEnd: true,
      counter: "0",
      onNavigate: () => {},
    },
    requestUndo: settings.takebacks
      ? {
          onClick: undo,
          disabled:
            botThinking || (boardRef.current?.engine.view_index() ?? 0) < 2,
        }
      : undefined,
    pass: {
      onClick: pass,
      disabled: !canHumanAct,
    },
    resign: {
      message: "Resign this bot game?",
      onConfirm: resign,
      disabled: !canHumanAct || botThinking,
    },
    aiSuggest: settings.hints
      ? {
          onClick: showAiSuggestion,
          active: aiSuggestActive,
          pending: aiSuggestPending,
          disabled: botThinking,
        }
      : undefined,
    estimate: settings.hints
      ? {
          onClick: toggleEstimate,
          active: estimateActive,
          disabled: botThinking,
        }
      : undefined,
    newGame: {
      onClick: onNewGame,
      title: "New game",
    },
  };

  return (
    <GamePageLayout
      gobanRef={gobanRef}
      gobanStyle={`aspect-ratio: ${BOARD_SIZE}/${BOARD_SIZE}`}
      playerTop={
        <BotPlayer
          label={humanStone === 1 ? "white" : "black"}
          thinking={
            botThinking && currentTurn === -1 && currentTurn !== humanStone
          }
        />
      }
      playerBottom={
        <UserLabel
          user={user!}
          options={{ stone: humanStone === 1 ? "black" : "white" }}
        />
      }
      status={
        <GameStatus text={status} warn={!!error}>
          {error ? <span>{error}</span> : null}
        </GameStatus>
      }
      controls={
        <div class={`controls-row${compact ? " controls-row--compact" : ""}`}>
          <span class="controls-start"></span>
          <span class="btn-group controls-middle">
            <GameControls {...controls} />
          </span>
          <span class="btn-group controls-end">
            <UIControls {...controls} compact={compact} />
          </span>
        </div>
      }
    />
  );
}

function BotPlayer({
  label,
  thinking,
}: {
  label: "black" | "white";
  thinking: boolean;
}) {
  return (
    <>
      <span class="player-name-group">
        <span class="stone-icon">
          {label === "black" ? <StoneBlack /> : <StoneWhite />}
        </span>
        <span class="user-label">
          {thinking ? <IconSpinner /> : <IconBot />} Seki Bot
        </span>
      </span>
    </>
  );
}
