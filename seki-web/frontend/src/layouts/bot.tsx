import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { AiAnalyzePositionResult } from "../ai-poc/types";
import { KATA9X9_MANIFEST, analyzePositionDirect } from "../ai/analyze";
import {
  ghostStoneMapFromRootMoves,
  heatMapFromRootMoves,
} from "../ai/heatmap";
import { ensureAiModelAvailable } from "../ai/model-download";
import { aiPositionFromEngine } from "../ai/position";
import type { ControlsProps } from "../components/controls-shared";
import { GameStatus } from "../components/game-status";
import { IconBot, IconSpinner } from "../components/icons";
import { PlayerPanel } from "../components/player-panel";
import { buildPlayerPanels } from "../game/capabilities";
import { playPassSound, playStoneSound } from "../game/sound";
import { GameStage, UserData, type ScoreData } from "../game/types";
import { readUserData } from "../game/util";
import {
  createBoard,
  ensureWasm,
  type Board,
  type NavAction,
} from "../goban/create-board";
import type { GhostStoneData, HeatData, Sign } from "../goban/types";
import { readShowCoordinates } from "../utils/coord-toggle";
import { formatResult } from "../utils/format";
import { useIsMobile } from "../utils/media-query";
import {
  createMoveConfirm,
  dismissMoveConfirmOnClickOutside,
  handleMoveConfirmClick,
  type MoveConfirmState,
} from "../utils/move-confirm";
import { storage } from "../utils/storage";
import { estimateCacheKey } from "./analysis-session/overlays";
import { chooseBotMove } from "./bot-move";
import { scoreBotGameFromEngine, scoreBotGameFromOwnership } from "./bot-score";
import { Controls } from "./controls";
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
type CachedAiAnalysis = {
  heatMap: (HeatData | null)[];
  ghostStoneMap: (GhostStoneData | null)[];
  ownership?: number[];
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
        onStart={async (settings) => {
          if (
            !(await ensureAiModelAvailable({
              manifestUrl: KATA9X9_MANIFEST,
              context: "bot",
            }))
          ) {
            return;
          }

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
  onStart: (settings: BotSettings) => void | Promise<void>;
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
    void onStart({ color, hints, takebacks });
  }

  return (
    <form onSubmit={submit}>
      <div>
        <SettingsFieldset title="Bot Practice">
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
  const scoringRequestIdRef = useRef(0);
  const botThinkingRef = useRef(false);
  const suppressBotRef = useRef(false);
  const applyingBotMoveRef = useRef(false);
  const scoringRef = useRef(false);
  const finalResultRef = useRef<string | undefined>(undefined);
  const humanStoneRef = useRef<StoneChoice>(
    settings.color === "black" ? 1 : -1,
  );
  const hintHeatRef = useRef<(HeatData | null)[] | undefined>(undefined);
  const hintGhostRef = useRef<(GhostStoneData | null)[] | undefined>(undefined);
  const mcRef = useRef<MoveConfirmState | null>(null);
  const aiCacheRef = useRef<Map<string, CachedAiAnalysis>>(new Map());
  const analysisInFlightRef = useRef<
    Map<string, Promise<CachedAiAnalysis | undefined>>
  >(new Map());
  const estimateRequestIdRef = useRef(0);
  const togglesRef = useRef({ aiSuggest: false, estimate: false });

  if (!mcRef.current) {
    mcRef.current = createMoveConfirm({
      getSign: () => humanStoneRef.current,
    });
  }

  const [botThinking, setBotThinking] = useState(false);
  const [status, setStatus] = useState("Loading board");
  const [error, setError] = useState<string | undefined>(undefined);
  const [canHumanAct, setCanHumanAct] = useState(false);
  const [currentTurn, setCurrentTurn] = useState<StoneChoice>(1);
  const [aiSuggestPending, setAiSuggestPending] = useState(false);
  const [aiSuggestActive, setAiSuggestActive] = useState(false);
  const [estimateActive, setEstimateActive] = useState(false);
  const [estimatePending, setEstimatePending] = useState(false);
  const [pendingMcMove, setPendingMcMove] = useState(false);
  const [captures, setCaptures] = useState({ black: 0, white: 0 });
  const [finalScore, setFinalScore] = useState<ScoreData | undefined>(
    undefined,
  );
  const [navState, setNavState] = useState({
    atStart: true,
    atLatest: true,
    atMainEnd: true,
    counter: "0",
  });

  const humanStone = settings.color === "black" ? 1 : -1;

  humanStoneRef.current = humanStone;
  botThinkingRef.current = botThinking;
  togglesRef.current.aiSuggest = aiSuggestActive;
  togglesRef.current.estimate = estimateActive;

  const [user] = useState<UserData | undefined>(() => readUserData());

  useEffect(() => {
    let disposed = false;
    const requestIdBase = ++requestIdRef.current;

    async function initBoard() {
      const gobanEl = gobanRef.current;

      boardRef.current?.destroy();
      boardRef.current = undefined;
      scoringRef.current = false;
      finalResultRef.current = undefined;
      scoringRequestIdRef.current += 1;
      setError(undefined);
      setStatus("Loading board");
      setCanHumanAct(false);
      setCaptures({ black: 0, white: 0 });
      setFinalScore(undefined);
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
        ghostStoneOverlay: () => hintGhostRef.current,
        heatOverlay: () => hintHeatRef.current,
        territoryReviewOwnership: () => {
          const board = boardRef.current;

          if (!board) {
            return undefined;
          }

          return aiCacheRef.current.get(estimateCacheKey(board, KOMI))
            ?.ownership;
        },
        onStonePlay: () => {
          playStoneSound();
          clearHintOverlay(false, !applyingBotMoveRef.current);
          cancelEstimateRequest();
          setEstimateActive(false);
          setError(undefined);
        },
        onPass: () => {
          playPassSound();
          clearHintOverlay(false, !applyingBotMoveRef.current);
          cancelEstimateRequest();
          setEstimateActive(false);
          setError(undefined);
        },
        onTerritoryReviewStart: () => {
          void finalizeWithEngineScore();
          return true;
        },
        ghostStone: () => mcRef.current?.getGhostStone(),
        onVertexClick: (col: number, row: number) => {
          const board = boardRef.current;
          const mc = mcRef.current;

          if (!board) {
            return true;
          }

          if (!board.engine.is_at_main_end()) {
            board.navigate("main-end");
            return true;
          }

          if (!canHumanPlay()) {
            return true;
          }

          if (!mc?.enabled) {
            return false;
          }

          const action = handleMoveConfirmClick(
            mc,
            col,
            row,
            board.engine.is_legal(col, row),
          );

          setPendingMcMove(!!mc.value);

          if (action === "confirm") {
            return false;
          }

          board.render();
          return true;
        },
        onNavigate: () => {
          cancelAiRequests();
          hintHeatRef.current = undefined;
          hintGhostRef.current = undefined;

          if (botThinkingRef.current) {
            botThinkingRef.current = false;
            setBotThinking(false);
          }

          mcRef.current?.clear();
          setPendingMcMove(false);

          if (togglesRef.current.aiSuggest) {
            refreshAiSuggestion();
          } else {
            setAiSuggestActive(false);
          }

          if (togglesRef.current.estimate) {
            refreshEstimate();
          } else {
            setEstimateActive(false);
          }
        },
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
      // Land on the main-line tip: for a finished game (ended in passes)
      // this re-applies the final score/territory overlay, since the last
      // pass node isn't persisted as the view position.
      board.navigate("main-end");
      syncUi();
      maybeRequestBotMove();
    }

    function canHumanPlay() {
      const board = boardRef.current;

      return (
        !!board &&
        !finalResultRef.current &&
        !botThinkingRef.current &&
        !scoringRef.current &&
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

      const engine = board.engine;
      const atMainEnd = engine.is_at_main_end();

      setNavState({
        atStart: engine.is_at_start(),
        atLatest: atMainEnd,
        atMainEnd,
        counter: `${engine.view_index()}`,
      });

      if (finalResultRef.current) {
        setStatus(finalResultRef.current);
        setCanHumanAct(false);
        return;
      }

      if (scoringRef.current) {
        setStatus("Scoring game");
        setCanHumanAct(false);
        return;
      }

      const stage = board.engine.stage();
      const turn = board.engine.current_turn_stone() as StoneChoice;

      setCaptures({
        black: board.engine.captures_black(),
        white: board.engine.captures_white(),
      });
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

    async function finalizeWithEngineScore() {
      const board = boardRef.current;

      if (!board) {
        return;
      }

      const requestId = ++scoringRequestIdRef.current;
      const nodeId = board.engine.current_node_id();
      scoringRef.current = true;
      setStatus("Scoring game");
      setCanHumanAct(false);
      setError(undefined);

      try {
        const analysis = await ensurePositionAnalysis(board);

        if (
          disposed ||
          requestId !== scoringRequestIdRef.current ||
          boardRef.current !== board ||
          board.engine.current_node_id() !== nodeId
        ) {
          return;
        }

        const aiFinal =
          analysis?.ownership &&
          scoreBotGameFromOwnership({
            cols: board.engine.cols(),
            rows: board.engine.rows(),
            board: Array.from(board.engine.board()),
            capturesBlack: board.engine.captures_black(),
            capturesWhite: board.engine.captures_white(),
            ownership: analysis.ownership,
          });

        let final = aiFinal;

        if (!final) {
          // No AI ownership available — fall back to the engine heuristic.
          const deadStonesJson = board.engine.detect_dead_stones();
          const ownershipJson = board.engine.estimate_territory(deadStonesJson);
          const scoreJson = board.engine.score(deadStonesJson, KOMI);

          final = scoreBotGameFromEngine({
            cols: board.engine.cols(),
            rows: board.engine.rows(),
            scoreJson,
            ownershipJson,
            deadStonesJson,
          });
        }

        if (!final) {
          throw new Error("Engine score did not return territory");
        }

        const finalResult = formatResult(final.score, KOMI);

        finalResultRef.current = finalResult;
        setFinalScore(final.score);
        setStatus(finalResult);
        board.setPassiveOverlay(final.overlay);
      } catch (err) {
        if (!disposed && requestId === scoringRequestIdRef.current) {
          setError(err instanceof Error ? err.message : String(err));
          setStatus("Scoring failed");
        }
      } finally {
        if (!disposed && requestId === scoringRequestIdRef.current) {
          scoringRef.current = false;
          setCanHumanAct(false);
        }
      }
    }

    async function maybeRequestBotMove() {
      const board = boardRef.current;

      if (
        !board ||
        disposed ||
        finalResultRef.current ||
        scoringRef.current ||
        suppressBotRef.current ||
        botThinkingRef.current ||
        !board.engine.is_at_main_end() ||
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
        if (
          !(await ensureAiModelAvailable({
            manifestUrl: KATA9X9_MANIFEST,
            context: "bot",
          }))
        ) {
          throw new Error("AI model download cancelled");
        }

        const botStone = board.engine.current_turn_stone() as StoneChoice;
        const positionKey = estimateCacheKey(board, KOMI);
        const result = await analyzePositionDirect(
          aiPositionFromEngine(board.engine, KOMI),
        );

        if (disposed) {
          return;
        }

        cacheAiAnalysis(result, botStone, positionKey);

        if (requestId !== requestIdRef.current || boardRef.current !== board) {
          return;
        }

        const { move } = chooseBotMove({
          rootMoves: result.analysis.rootMoves,
          botStone,
          lastMoveWasPass: board.engine.last_move_was_pass(),
          whiteScoreMean: result.analysis.scoreMean,
        });

        applyingBotMoveRef.current = true;
        try {
          if (move.kind === "pass") {
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

  useEffect(() => {
    const mc = mcRef.current;

    if (!mc) {
      return;
    }

    return dismissMoveConfirmOnClickOutside(
      mc,
      () => gobanRef.current,
      () => {
        setPendingMcMove(false);
        boardRef.current?.render();
      },
    );
  }, []);

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

  function cancelAiRequests() {
    requestIdRef.current += 1;
    estimateRequestIdRef.current += 1;
    setAiSuggestPending(false);
    setEstimatePending(false);
  }

  function cacheAiAnalysis(
    result: AiAnalyzePositionResult,
    sign: Sign,
    positionKey: string,
  ): CachedAiAnalysis {
    const analysis: CachedAiAnalysis = {
      heatMap: heatMapFromRootMoves(result.analysis.rootMoves, BOARD_SIZE),
      ghostStoneMap: ghostStoneMapFromRootMoves(
        result.analysis.rootMoves,
        BOARD_SIZE,
        sign,
      ),
      ownership: normalizeOwnership(result.analysis.ownership),
    };

    aiCacheRef.current.set(positionKey, analysis);
    return analysis;
  }

  function normalizeOwnership(
    ownership: number[] | undefined,
  ): number[] | undefined {
    return ownership?.map((value) =>
      Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0,
    );
  }

  /**
   * Full analysis (suggestion + ownership) for the current position: one
   * position-keyed cache (a pass does not change the board, so the bot's
   * pre-pass analysis hits the final position), else one inference shared by
   * all callers via the in-flight map.
   */
  async function ensurePositionAnalysis(
    board: Board,
  ): Promise<CachedAiAnalysis | undefined> {
    const positionKey = estimateCacheKey(board, KOMI);
    const cached = aiCacheRef.current.get(positionKey);

    if (cached) {
      return cached;
    }

    const inFlight = analysisInFlightRef.current.get(positionKey);

    if (inFlight) {
      return inFlight;
    }

    const pending = runPositionAnalysis(board);
    analysisInFlightRef.current.set(positionKey, pending);

    try {
      return await pending;
    } finally {
      if (analysisInFlightRef.current.get(positionKey) === pending) {
        analysisInFlightRef.current.delete(positionKey);
      }
    }
  }

  async function runPositionAnalysis(
    board: Board,
  ): Promise<CachedAiAnalysis | undefined> {
    if (
      !(await ensureAiModelAvailable({
        manifestUrl: KATA9X9_MANIFEST,
        context: "bot",
      }))
    ) {
      return undefined;
    }

    try {
      const sign = board.engine.current_turn_stone() as Sign;
      const positionKey = estimateCacheKey(board, KOMI);
      const result = await analyzePositionDirect(
        aiPositionFromEngine(board.engine, KOMI),
      );

      return cacheAiAnalysis(result, sign, positionKey);
    } catch {
      return undefined;
    }
  }

  async function computeAiSuggestion() {
    const board = boardRef.current;

    if (!board || aiSuggestPending) {
      return;
    }

    const requestId = ++requestIdRef.current;
    const nodeId = board.engine.current_node_id();
    setAiSuggestPending(true);
    setError(undefined);

    try {
      const analysis = await ensurePositionAnalysis(board);

      if (
        requestId !== requestIdRef.current ||
        boardRef.current !== board ||
        board.engine.current_node_id() !== nodeId
      ) {
        return;
      }

      if (analysis) {
        hintHeatRef.current = analysis.heatMap;
        hintGhostRef.current = analysis.ghostStoneMap;
        setAiSuggestActive(true);
        board.renderBoardOnly();
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setAiSuggestPending(false);
      }
    }
  }

  function refreshAiSuggestion() {
    const board = boardRef.current;

    if (!board) {
      return;
    }

    const cached = aiCacheRef.current.get(estimateCacheKey(board, KOMI));

    if (cached) {
      hintHeatRef.current = cached.heatMap;
      hintGhostRef.current = cached.ghostStoneMap;
      setAiSuggestActive(true);
      board.renderBoardOnly();
      return;
    }

    void computeAiSuggestion();
  }

  function cancelEstimateRequest() {
    estimateRequestIdRef.current += 1;
    setEstimatePending(false);
  }

  async function applyEstimate(board: Board) {
    const requestId = ++estimateRequestIdRef.current;
    const nodeId = board.engine.current_node_id();
    setEstimatePending(true);

    const analysis = await ensurePositionAnalysis(board);

    if (
      requestId !== estimateRequestIdRef.current ||
      boardRef.current !== board ||
      board.engine.current_node_id() !== nodeId
    ) {
      return;
    }

    setEstimatePending(false);

    if (analysis?.ownership) {
      board.enterEstimate();
      setEstimateActive(true);
    } else {
      setEstimateActive(false);
    }
  }

  function refreshEstimate() {
    const board = boardRef.current;

    if (!board) {
      return;
    }

    void applyEstimate(board);
  }

  async function showAiSuggestion() {
    if (!boardRef.current || aiSuggestPending) {
      return;
    }

    if (aiSuggestActive) {
      clearHintOverlay();
      return;
    }

    refreshAiSuggestion();
  }

  async function toggleEstimate() {
    const board = boardRef.current;

    if (!board || estimatePending) {
      return;
    }

    if (estimateActive) {
      board.exitTerritoryReview();
      setEstimateActive(false);
      return;
    }

    await applyEstimate(board);
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

    if (!board.engine.is_at_main_end()) {
      return;
    }

    suppressBotRef.current = true;
    clearHintOverlay(false, true);
    cancelEstimateRequest();
    setEstimateActive(false);
    mcRef.current?.clear();
    setPendingMcMove(false);

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
    mcRef.current?.clear();
    setPendingMcMove(false);
  }

  function handleNavigate(action: NavAction) {
    const board = boardRef.current;

    if (!board) {
      return;
    }

    if (action === "forward" && board.engine.is_at_main_end()) {
      return;
    }

    board.navigate(action === "end" ? "main-end" : action);
  }

  const isMobile = useIsMobile();
  const botGameLocked = scoringRef.current || !!finalResultRef.current;
  const panelScores = buildPlayerPanels({
    komi: KOMI,
    captures,
    score: finalScore,
  });
  const blackPanel = {
    ...panelScores.black,
    stone: "black" as const,
    strong: currentTurn === 1 && !botGameLocked,
  };
  const whitePanel = {
    ...panelScores.white,
    stone: "white" as const,
    strong: currentTurn === -1 && !botGameLocked,
  };
  const topPanel = humanStone === 1 ? whitePanel : blackPanel;
  const bottomPanel = humanStone === 1 ? blackPanel : whitePanel;
  const controls: ControlsProps = {
    nav: {
      atStart: navState.atStart,
      atLatest: navState.atLatest,
      atMainEnd: navState.atMainEnd,
      counter: navState.counter,
      onNavigate: handleNavigate,
    },
    requestUndo: settings.takebacks
      ? {
          onClick: undo,
          disabled:
            botThinking ||
            botGameLocked ||
            (boardRef.current?.engine.view_index() ?? 0) < 2 ||
            !(boardRef.current?.engine.is_at_main_end() ?? true),
        }
      : undefined,
    pass: {
      onClick: pass,
      disabled: !canHumanAct || botGameLocked,
    },
    resign: {
      message: "Resign this bot game?",
      onConfirm: resign,
      disabled: !canHumanAct || botThinking || botGameLocked,
    },
    confirmMove: pendingMcMove
      ? {
          onClick: () => {
            const mc = mcRef.current;
            const pos = mc?.value;

            if (pos && boardRef.current) {
              const [col, row] = pos;

              mc.clear();
              setPendingMcMove(false);
              boardRef.current.playMove(col, row);
            }
          },
        }
      : undefined,
    aiSuggest: settings.hints
      ? {
          onClick: showAiSuggestion,
          active: aiSuggestActive,
          pending: aiSuggestPending,
          disabled: botThinking || botGameLocked,
        }
      : undefined,
    estimate: settings.hints
      ? {
          onClick: toggleEstimate,
          active: estimateActive,
          pending: estimatePending,
          disabled: botThinking || botGameLocked,
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
      cols={BOARD_SIZE}
      rows={BOARD_SIZE}
      playerTop={
        <PlayerPanel
          {...topPanel}
          label={
            <BotLabel thinking={botThinking && currentTurn !== humanStone} />
          }
        />
      }
      playerBottom={
        <PlayerPanel {...bottomPanel} userData={user} rank={user?.rank} />
      }
      status={
        <GameStatus text={status} warn={!!error}>
          {error ? <span>{error}</span> : null}
        </GameStatus>
      }
      controls={<Controls {...controls} compact={isMobile} />}
    />
  );
}

function BotLabel({ thinking }: { thinking: boolean }) {
  return <>{thinking ? <IconSpinner /> : <IconBot />} Seki Bot</>;
}
