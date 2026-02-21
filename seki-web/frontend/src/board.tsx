import { render } from "preact";
import { Goban } from "./goban/index";
import type { GhostStoneData, GameTreeData, MarkerData, Point, ScoreData, Sign } from "./goban/types";
import { MoveTree } from "./move-tree";
import type { WasmEngine } from "/static/wasm/go_engine_wasm.js";
import { GameDomElements } from "./game-dom";
import { flashPassEffect } from "./game-messages";

const koMarker: MarkerData = { type: "triangle", label: "ko" };

let wasmModule: typeof import("/static/wasm/go_engine_wasm.js") | undefined;

export async function ensureWasm(): Promise<
  typeof import("/static/wasm/go_engine_wasm.js")
> {
  if (wasmModule) {
    return wasmModule;
  }
  const wasm = await import("/static/wasm/go_engine_wasm.js");
  await wasm.default();
  wasmModule = wasm;
  return wasm;
}

export type NavButtons = {
  start: HTMLButtonElement | null;
  back: HTMLButtonElement | null;
  forward: HTMLButtonElement | null;
  end: HTMLButtonElement | null;
  counter: HTMLElement | null;
};

export function findNavButtons(): NavButtons {
  return {
    start: document.getElementById("start-btn") as HTMLButtonElement | null,
    back: document.getElementById("back-btn") as HTMLButtonElement | null,
    forward: document.getElementById("forward-btn") as HTMLButtonElement | null,
    end: document.getElementById("end-btn") as HTMLButtonElement | null,
    counter: document.getElementById("move-counter"),
  };
}

function updateNavButtons(engine: WasmEngine, buttons: NavButtons): void {
  const atStart = engine.is_at_start();
  const atLatest = engine.is_at_latest();

  if (buttons.start) {
    buttons.start.disabled = atStart;
  }
  if (buttons.back) {
    buttons.back.disabled = atStart;
  }
  if (buttons.forward) {
    buttons.forward.disabled = atLatest;
  }
  if (buttons.end) {
    buttons.end.disabled = atLatest;
  }
  if (buttons.counter) {
    buttons.counter.textContent = `${engine.view_index()} / ${engine.total_moves()}`;
  }
}

function computeVertexSize(
  gobanEl: HTMLElement,
  cols: number,
  rows: number,
  showCoordinates?: boolean,
): number {
  const avail = gobanEl.clientWidth;
  const extra = 0.8;
  // When coordinates are shown, the grid has 1em labels on each side.
  // Solve: vertexSize * (maxDim + extra) + 2 * vertexSize = avail
  // => vertexSize * (maxDim + extra + 2) = avail
  const coordExtra = showCoordinates ? 2 : 0;
  return Math.max(avail / (Math.max(cols, rows) + extra + coordExtra), 12);
}

export type TerritoryOverlay = {
  paintMap: (number | null)[];
  dimmedVertices: Point[];
};

type GhostStoneGetter = () => { col: number; row: number; sign: Sign } | undefined;

function renderFromEngine(
  engine: WasmEngine,
  gobanEl: HTMLElement,
  onVertexClick?: (evt: Event, position: Point) => void,
  overlay?: TerritoryOverlay,
  showCoordinates?: boolean,
  ghostStone?: GhostStoneGetter,
): void {
  const board = [...engine.board()] as number[];
  const cols = engine.cols();
  const rows = engine.rows();
  const markerMap: (MarkerData | null)[] = Array(board.length).fill(null);

  if (!overlay) {
    if (engine.has_last_move()) {
      const lc = engine.last_move_col();
      const lr = engine.last_move_row();
      markerMap[lr * cols + lc] = { type: "circle" };
    }

    if (engine.has_ko()) {
      const kc = engine.ko_col();
      const kr = engine.ko_row();
      markerMap[kr * cols + kc] = koMarker;
    }
  }

  let ghostStoneMap: (GhostStoneData | null)[] | undefined;
  if (ghostStone) {
    const gs = ghostStone();
    if (gs) {
      ghostStoneMap = Array(board.length).fill(null);
      ghostStoneMap![gs.row * cols + gs.col] = { sign: gs.sign };
    }
  }

  render(
    <Goban
      cols={cols}
      rows={rows}
      vertexSize={computeVertexSize(gobanEl, cols, rows, showCoordinates)}
      signMap={board}
      markerMap={markerMap}
      ghostStoneMap={ghostStoneMap}
      paintMap={overlay?.paintMap}
      dimmedVertices={overlay?.dimmedVertices}
      showCoordinates={showCoordinates}
      fuzzyStonePlacement
      animateStonePlacement
      onVertexClick={onVertexClick}
    />,
    gobanEl,
  );
}

function renderMoveTree(
  engine: WasmEngine,
  moveTreeEl: HTMLElement,
  doRender: () => void,
  finalizedNodeIds?: Set<number>,
  direction?: "horizontal" | "vertical",
  branchAfterNodeId?: number,
  onReset?: () => void,
): void {
  const treeJson = engine.tree_json();
  const tree: GameTreeData = JSON.parse(treeJson);
  let currentNodeId = engine.current_node_id();

  // Inject synthetic root node for the empty board
  const rootId = tree.nodes.length;
  tree.nodes.push({
    turn: { kind: "pass", stone: 0, pos: null },
    parent: null,
    children: [...tree.root_children],
  });
  for (const childId of tree.root_children) {
    tree.nodes[childId].parent = rootId;
  }
  tree.root_children = [rootId];
  if (currentNodeId === -1) {
    currentNodeId = rootId;
  }

  render(
    <MoveTree
      tree={tree}
      currentNodeId={currentNodeId}
      finalizedNodeIds={finalizedNodeIds}
      branchAfterNodeId={branchAfterNodeId}
      direction={direction}
      onNavigate={(nodeId) => {
        if (nodeId === rootId) {
          engine.to_start();
        } else {
          engine.navigate_to(nodeId);
        }
        doRender();
      }}
      onReset={onReset}
    />,
    moveTreeEl,
  );
}

export type NavAction = "back" | "forward" | "start" | "end";

function navigateEngine(engine: WasmEngine, action: NavAction): boolean {
  switch (action) {
    case "back":
      return engine.back();
    case "forward":
      return engine.forward();
    case "start":
      engine.to_start();
      return true;
    case "end":
      engine.to_latest();
      return true;
  }
}

// --- Board factory ---

export type TerritoryInfo = {
  reviewing: boolean;
  finalized: boolean;
  score: ScoreData | undefined;
};

export type BoardConfig = {
  cols: number;
  rows: number;
  handicap?: number;
  showCoordinates?: boolean;
  gobanEl: GameDomElements["goban"];
  moveTreeEl?: HTMLElement | null;
  moveTreeDirection?: "horizontal" | "vertical" | "responsive";
  storageKey?: string;
  baseMoves?: string;
  branchAtBaseTip?: boolean;
  komi?: number;
  navButtons?: NavButtons;
  buttons?: {
    undo?: GameDomElements["requestUndoBtn"];
    pass?: GameDomElements["passBtn"];
  };
  ghostStone?: GhostStoneGetter;
  territoryOverlay?: () => TerritoryOverlay | undefined;
  onRender?: (engine: WasmEngine, territory: TerritoryInfo) => void;
  onVertexClick?: (col: number, row: number) => boolean;
  onStonePlay?: () => void;
  onPass?: () => void;
};

export type Board = {
  engine: WasmEngine;
  save: () => void;
  render: () => void;
  navigate: (action: NavAction) => void;
  updateBaseMoves: (movesJson: string, replaceEngine?: boolean) => void;
  updateNav: () => void;
  setShowCoordinates: (show: boolean) => void;
  enterTerritoryReview: () => void;
  exitTerritoryReview: () => void;
  finalizeTerritoryReview: () => ScoreData | undefined;
  isTerritoryReview: () => boolean;
  isFinalized: () => boolean;
  destroy: () => void;
  savedBaseMoves?: string;
};

const wideQuery = window.matchMedia("(min-width: 1200px)");

export async function createBoard(config: BoardConfig): Promise<Board> {
  const wasm = await ensureWasm();
  const engine = new wasm.WasmEngine(config.cols, config.rows);
  if (config.handicap && config.handicap >= 2) {
    engine.set_handicap(config.handicap);
  }
  const komi = config.komi ?? 6.5;
  let showCoordinates = config.showCoordinates ?? false;

  function resolveTreeDirection(): "horizontal" | "vertical" | undefined {
    if (config.moveTreeDirection === "responsive") {
      return wideQuery.matches ? "vertical" : "horizontal";
    }
    return config.moveTreeDirection;
  }

  // Base moves the board can be reset to (e.g. game moves from WS)
  let baseMoves = config.baseMoves ?? "[]";
  let baseMoveCount = (JSON.parse(baseMoves) as unknown[]).length;

  // Initialize from localStorage or baseMoves
  const saved = config.storageKey
    ? localStorage.getItem(config.storageKey)
    : null;
  let restoredBaseMoves: string | undefined;
  if (saved) {
    // Try restoring a tree first, fall back to flat moves
    if (!engine.replace_tree(saved)) {
      engine.replace_moves(saved);
    }
    // Restore saved base move count for correct tree branching
    const savedBase = localStorage.getItem(`${config.storageKey}:base`);
    if (savedBase) {
      baseMoves = savedBase;
      baseMoveCount = (JSON.parse(savedBase) as unknown[]).length;
      restoredBaseMoves = savedBase;
    }
    // Restore saved position instead of always going to latest
    const savedNodeId = config.storageKey
      ? localStorage.getItem(`${config.storageKey}:node`)
      : null;
    if (savedNodeId != null) {
      const id = parseInt(savedNodeId, 10);
      if (id >= 0) {
        engine.navigate_to(id);
      } else {
        engine.to_start();
      }
    } else {
      engine.to_latest();
    }
  } else if (baseMoves !== "[]") {
    engine.replace_moves(baseMoves);
    engine.to_latest();
  }

  // --- Territory review state ---
  type TerritoryState = {
    deadStones: [number, number][];
    ownership: number[];
    score: ScoreData | undefined;
  };
  let territoryState: TerritoryState | undefined;

  // Finalized nodes: nodeId → dead stones at finalization
  let finalizedNodes = loadFinalizedNodes();

  function loadFinalizedNodes(): Map<number, [number, number][]> {
    if (!config.storageKey) {
      return new Map();
    }
    const raw = localStorage.getItem(`${config.storageKey}:finalized`);
    if (!raw) {
      return new Map();
    }
    try {
      const data: Record<string, [number, number][]> = JSON.parse(raw);
      const map = new Map<number, [number, number][]>();
      for (const [k, v] of Object.entries(data)) {
        map.set(Number(k), v);
      }
      return map;
    } catch {
      return new Map();
    }
  }

  function saveFinalizedNodes() {
    if (!config.storageKey) {
      return;
    }
    if (finalizedNodes.size === 0) {
      localStorage.removeItem(`${config.storageKey}:finalized`);
      return;
    }
    const data: Record<string, [number, number][]> = {};
    for (const [id, dead] of finalizedNodes) {
      data[String(id)] = dead;
    }
    localStorage.setItem(
      `${config.storageKey}:finalized`,
      JSON.stringify(data),
    );
  }

  function buildOverlay(
    deadStones: [number, number][],
    ownership: number[],
  ): TerritoryOverlay {
    const size = engine.cols() * engine.rows();
    const paintMap: (number | null)[] = new Array(size);
    for (let i = 0; i < size; i++) {
      paintMap[i] = ownership[i] || null;
    }
    const dimmedVertices: Point[] = deadStones;
    return { paintMap, dimmedVertices };
  }

  function computeTerritoryState(
    deadStones: [number, number][],
  ): TerritoryState {
    const deadJson = JSON.stringify(deadStones);
    const ownership: number[] = JSON.parse(engine.estimate_territory(deadJson));
    const scoreJson = engine.score(deadJson, komi);
    const parsed = JSON.parse(scoreJson);
    const score: ScoreData = {
      black: parsed.black,
      white: parsed.white,
    };
    return { deadStones, ownership, score };
  }

  function enterTerritory() {
    const deadJson = engine.detect_dead_stones();
    const deadStones: [number, number][] = JSON.parse(deadJson);
    territoryState = computeTerritoryState(deadStones);
    doRender();
  }

  function exitTerritory() {
    territoryState = undefined;
    doRender();
  }

  function finalizeTerritory(): ScoreData | undefined {
    if (!territoryState) {
      return undefined;
    }
    const nodeId = engine.current_node_id();
    if (nodeId < 0) {
      return undefined;
    }
    const score = territoryState.score;
    finalizedNodes.set(nodeId, territoryState.deadStones);
    saveFinalizedNodes();
    territoryState = undefined;
    doRender();
    return score;
  }

  function save() {
    if (config.storageKey) {
      localStorage.setItem(config.storageKey, engine.tree_json());
      localStorage.setItem(`${config.storageKey}:base`, baseMoves);
    }
  }

  function doReset() {
    if (config.storageKey) {
      localStorage.removeItem(config.storageKey);
      localStorage.removeItem(`${config.storageKey}:base`);
      localStorage.removeItem(`${config.storageKey}:finalized`);
      localStorage.removeItem(`${config.storageKey}:node`);
    }
    territoryState = undefined;
    finalizedNodes = new Map();
    engine.replace_moves(baseMoves);
    engine.to_latest();
    doRender();
  }

  function doRenderBoard(): TerritoryInfo {
    const nodeId = engine.current_node_id();
    const finalized = nodeId >= 0 && finalizedNodes.has(nodeId);

    let overlay: TerritoryOverlay | undefined;
    let territoryInfo: TerritoryInfo;

    if (finalized) {
      // Read-only territory display for finalized node
      const deadStones = finalizedNodes.get(nodeId)!;
      const ts = computeTerritoryState(deadStones);
      overlay = buildOverlay(ts.deadStones, ts.ownership);
      territoryInfo = { reviewing: false, finalized: true, score: ts.score };
    } else if (territoryState) {
      // Active territory review
      overlay = buildOverlay(
        territoryState.deadStones,
        territoryState.ownership,
      );
      territoryInfo = {
        reviewing: true,
        finalized: false,
        score: territoryState.score,
      };
    } else if (config.territoryOverlay && engine.is_at_latest()) {
      // Server-sent territory data (live game)
      const serverOverlay = config.territoryOverlay();
      if (serverOverlay) {
        overlay = serverOverlay;
        territoryInfo = { reviewing: true, finalized: false, score: undefined };
      } else {
        territoryInfo = { reviewing: false, finalized: false, score: undefined };
      }
    } else {
      territoryInfo = { reviewing: false, finalized: false, score: undefined };
    }

    const onVertexClick = (_: Event, [col, row]: Point) => {
      // Finalized: no interaction
      if (finalized) {
        return;
      }

      // Territory review: toggle dead stones
      if (territoryState) {
        const deadJson = engine.toggle_dead_chain(
          col,
          row,
          JSON.stringify(territoryState.deadStones),
        );
        const newDead: [number, number][] = JSON.parse(deadJson);
        territoryState = computeTerritoryState(newDead);
        doRender();
        return;
      }

      // Normal play
      if (config.onVertexClick && config.onVertexClick(col, row)) {
        return;
      }
      if (engine.try_play(col, row)) {
        config.onStonePlay?.();
        save();
        doRender();
      }
    };

    renderFromEngine(engine, config.gobanEl, onVertexClick, overlay, showCoordinates, config.ghostStone);

    return territoryInfo;
  }

  function doRender() {
    const territoryInfo = doRenderBoard();

    if (config.moveTreeEl) {
      const fIds =
        finalizedNodes.size > 0
          ? new Set(finalizedNodes.keys())
          : undefined;
      const branchId = config.branchAtBaseTip && baseMoveCount > 0
        ? baseMoveCount - 1
        : undefined;
      const treeSize = engine.tree_node_count();
      const hasAnalysis = branchId != null
        ? treeSize > baseMoveCount
        : treeSize > 0;
      renderMoveTree(engine, config.moveTreeEl, doRender, fIds, resolveTreeDirection(), branchId, hasAnalysis ? doReset : undefined);
    }

    if (config.navButtons) {
      updateNavButtons(engine, config.navButtons);
    }

    // Persist current node for restore on refresh
    if (config.storageKey) {
      localStorage.setItem(
        `${config.storageKey}:node`,
        String(engine.current_node_id()),
      );
    }

    if (config.onRender) {
      config.onRender(engine, territoryInfo);
    }
  }

  function doNavigate(action: NavAction) {
    // Clear active territory review when navigating
    if (territoryState) {
      territoryState = undefined;
    }
    if (navigateEngine(engine, action)) {
      // Auto-enter territory review if navigating to a two-pass position
      const stage = engine.stage();
      if (stage === "territory_review" && !isCurrentFinalized()) {
        enterTerritory();
        return;
      }
      doRender();
    }
  }

  function isCurrentFinalized(): boolean {
    const nodeId = engine.current_node_id();
    return nodeId >= 0 && finalizedNodes.has(nodeId);
  }

  function doUpdateBaseMoves(movesJson: string, replaceEngine = true) {
    baseMoves = movesJson;
    baseMoveCount = (JSON.parse(movesJson) as unknown[]).length;
    if (replaceEngine) {
      const wasAtLatest = engine.is_at_latest();
      engine.replace_moves(movesJson);
      if (wasAtLatest) {
        engine.to_latest();
      }
      if (config.moveTreeEl) {
        const fIds =
          finalizedNodes.size > 0
            ? new Set(finalizedNodes.keys())
            : undefined;
        const branchId = config.branchAtBaseTip && baseMoveCount > 0
          ? baseMoveCount - 1
          : undefined;
        const treeSize = engine.tree_node_count();
        const hasAnalysis = branchId != null
          ? treeSize > baseMoveCount
          : treeSize > 0;
        renderMoveTree(engine, config.moveTreeEl, doRender, fIds, resolveTreeDirection(), branchId, hasAnalysis ? doReset : undefined);
      }
    }
  }

  function doUpdateNav() {
    if (config.navButtons) {
      updateNavButtons(engine, config.navButtons);
    }
  }

  // --- Wire up button listeners ---
  const abortController = new AbortController();
  const opts = { signal: abortController.signal };

  if (config.navButtons) {
    config.navButtons.start?.addEventListener(
      "click",
      () => doNavigate("start"),
      opts,
    );
    config.navButtons.back?.addEventListener(
      "click",
      () => doNavigate("back"),
      opts,
    );
    config.navButtons.forward?.addEventListener(
      "click",
      () => doNavigate("forward"),
      opts,
    );
    config.navButtons.end?.addEventListener(
      "click",
      () => doNavigate("end"),
      opts,
    );
  }

  if (config.buttons) {
    config.buttons.undo?.addEventListener(
      "click",
      () => {
        if (territoryState || isCurrentFinalized()) {
          return;
        }
        if (engine.undo()) {
          save();
          doRender();
        }
      },
      opts,
    );

    config.buttons.pass?.addEventListener(
      "click",
      () => {
        const stage = engine.stage();
        if (isCurrentFinalized() || stage === "territory_review" || stage === "done") {
          return;
        }
        if (territoryState) {
          territoryState = undefined;
        }
        if (engine.pass()) {
          config.onPass?.();
          save();
          flashPassEffect(config.gobanEl);
          // Auto-enter territory review after two consecutive passes
          if (engine.stage() === "territory_review") {
            enterTerritory();
            return;
          }
          doRender();
        }
      },
      opts,
    );

  }

  // Keyboard navigation
  const keyHandler = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      return;
    }

    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        doNavigate("back");
        break;
      case "ArrowRight":
        e.preventDefault();
        doNavigate("forward");
        break;
      case "Home":
        e.preventDefault();
        doNavigate("start");
        break;
      case "End":
        e.preventDefault();
        doNavigate("end");
        break;
    }
  };
  document.addEventListener("keydown", keyHandler, opts);

  // Resize
  const resizeHandler = () => doRender();
  window.addEventListener("resize", resizeHandler, opts);

  // Initial render
  doRender();

  return {
    engine,
    save,
    render: doRender,
    navigate: doNavigate,
    updateBaseMoves: doUpdateBaseMoves,
    updateNav: doUpdateNav,
    setShowCoordinates: (show: boolean) => {
      showCoordinates = show;
      doRenderBoard();
    },
    enterTerritoryReview: enterTerritory,
    exitTerritoryReview: exitTerritory,
    finalizeTerritoryReview: finalizeTerritory,
    isTerritoryReview: () => !!territoryState,
    isFinalized: isCurrentFinalized,
    destroy: () => abortController.abort(),
    savedBaseMoves: restoredBaseMoves,
  };
}
