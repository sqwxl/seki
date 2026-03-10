import { render } from "preact";
import { MoveTree } from "../components/move-tree";
import { flashPassEffect } from "../game/messages";
import {
  GameStage,
  type GameTreeData,
  type PresentationSnapshot,
  type ScoreData,
} from "../game/types";
import { storage } from "../utils/storage";
import { DESKTOP_BREAKPOINT, DESKTOP_MQ } from "../utils/constants";
import { Goban } from "./";
import type { MarkerData, Point, Sign, GhostStoneData } from "./types";
import { WasmEngine } from "/static/wasm/go_engine_wasm.js";

// ---------------------------------------------------------------------------
// WASM singleton
// ---------------------------------------------------------------------------

const desktopMQ = window.matchMedia(DESKTOP_MQ);

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function computeVertexSize(
  gobanEl: HTMLElement,
  cols: number,
  rows: number,
  showCoordinates?: boolean,
): number {
  const w = gobanEl.clientWidth;
  const h = gobanEl.clientHeight;
  // On desktop the goban container has a CSS height from the grid row;
  // on mobile clientHeight is stale content height, so ignore it.
  const avail = desktopMQ.matches && h > 0 ? Math.min(w, h) : w;
  const extra = 0.8;
  const coordExtra = showCoordinates ? 2 : 0;
  return Math.max(avail / (Math.max(cols, rows) + extra + coordExtra), 12);
}

export type TerritoryOverlay = {
  paintMap: (number | null)[];
  dimmedVertices: Point[];
};

type GhostStoneGetter = () =>
  | { col: number; row: number; sign: Sign }
  | undefined;

function renderFromEngine(
  engine: WasmEngine,
  gobanEl: HTMLElement,
  onVertexClick?: (evt: Event, position: Point) => void,
  overlay?: TerritoryOverlay,
  showCoordinates?: boolean,
  ghostStone?: GhostStoneGetter,
  crosshairStone?: number,
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

  // On desktop, reset inline --col-width so we measure against the CSS default
  const body = desktopMQ.matches
    ? (gobanEl.closest(".game-page-body") as HTMLElement | null)
    : null;
  body?.style.removeProperty("--col-width");

  const vertexSize = computeVertexSize(gobanEl, cols, rows, showCoordinates);

  render(
    <Goban
      cols={cols}
      rows={rows}
      vertexSize={vertexSize}
      signMap={board}
      markerMap={markerMap}
      ghostStoneMap={ghostStoneMap}
      paintMap={overlay?.paintMap}
      dimmedVertices={overlay?.dimmedVertices}
      showCoordinates={showCoordinates}
      fuzzyStonePlacement
      animateStonePlacement
      onVertexClick={onVertexClick}
      crosshairStone={crosshairStone}
    />,
    gobanEl,
  );

  // Sync --col-width to the rendered board width
  if (body) {
    const goban = gobanEl.querySelector(".goban") as HTMLElement | null;
    if (goban) {
      body.style.setProperty("--col-width", `${goban.offsetWidth}px`);
    }
  }
}

// Cache for parsed tree data — only re-fetch from WASM when structure changes
let cachedTree: GameTreeData | undefined;
let cachedTreeNodeCount = -1;

export function invalidateTreeCache(): void {
  cachedTree = undefined;
  cachedTreeNodeCount = -1;
}

function renderMoveTree(
  engine: WasmEngine,
  moveTreeEl: HTMLElement,
  doRender: () => void,
  direction?: "horizontal" | "vertical",
  branchAfterNodeId?: number,
): void {
  const nodeCount = engine.tree_node_count();
  if (nodeCount !== cachedTreeNodeCount || !cachedTree) {
    try {
      cachedTree = JSON.parse(engine.tree_json());
      cachedTreeNodeCount = nodeCount;
    } catch {
      console.warn("Failed to parse move tree JSON");
      return;
    }
  }
  // cachedTree is guaranteed non-undefined here: the guard above either
  // assigns it or returns early on parse failure.
  const cached = cachedTree!;
  // Shallow copy so synthetic root injection doesn't mutate the cache
  const tree: GameTreeData = {
    nodes: [...cached.nodes],
    root_children: [...cached.root_children],
  };
  let currentNodeId = engine.current_node_id();

  // Inject synthetic root node for the empty board
  const rootId = tree.nodes.length;
  tree.nodes.push({
    turn: { kind: "pass", stone: 0, pos: null },
    parent: null,
    children: [...tree.root_children],
  });
  for (const childId of tree.root_children) {
    tree.nodes[childId] = { ...tree.nodes[childId], parent: rootId };
  }
  tree.root_children = [rootId];
  if (currentNodeId === -1) {
    currentNodeId = rootId;
  }

  render(
    <MoveTree
      tree={tree}
      currentNodeId={currentNodeId}
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
    />,
    moveTreeEl,
  );
}

export type NavAction = "back" | "forward" | "start" | "end" | "main-end";

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
    case "main-end":
      engine.to_main_end();
      return true;
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

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
  gobanEl: HTMLDivElement;
  moveTreeEl?: HTMLElement | null;
  moveTreeDirection?: "horizontal" | "vertical" | "responsive";
  storageKey?: string;
  baseMoves?: string;
  branchAtBaseTip?: boolean;
  komi?: number;
  ghostStone?: GhostStoneGetter;
  territoryOverlay?: () => TerritoryOverlay | undefined;
  onRender?: (engine: WasmEngine, territory: TerritoryInfo) => void;
  canPlay?: () => boolean;
  onVertexClick?: (col: number, row: number) => boolean;
  onStonePlay?: () => void;
  onPass?: () => void;
};

export type Board = {
  engine: WasmEngine;
  baseTipNodeId: number;
  restoredWithAnalysis: boolean;
  save: () => void;
  render: () => void;
  pass: () => boolean;
  navigate: (action: NavAction) => void;
  updateBaseMoves: (movesJson: string) => void;
  setShowCoordinates: (show: boolean) => void;
  setMoveTreeEl: (el: HTMLElement | null) => void;
  enterTerritoryReview: () => void;
  exitTerritoryReview: () => void;
  finalizeTerritoryReview: () => ScoreData | undefined;
  isTerritoryReview: () => boolean;
  isFinalized: () => boolean;
  markSettled: (deadStones: [number, number][]) => void;
  exportSnapshot: () => string;
  importSnapshot: (json: string) => void;
  destroy: () => void;
};

// ---------------------------------------------------------------------------
// BoardController — implements Board
// ---------------------------------------------------------------------------

type TerritoryState = {
  deadStones: [number, number][];
  ownership: number[];
  score: ScoreData | undefined;
};

class BoardController implements Board {
  readonly engine: WasmEngine;
  readonly restoredWithAnalysis: boolean;

  private config: BoardConfig;
  private komi: number;
  private showCoords: boolean;
  private baseMoves: string;
  private baseMoveCount: number;
  private _baseTipNodeId: number;
  private territoryState: TerritoryState | undefined;
  private finalizedNodes: Map<number, [number, number][]>;
  private finalizedTerritoryCache: Map<number, TerritoryState>;
  private abortController: AbortController;

  get baseTipNodeId(): number {
    return this._baseTipNodeId;
  }

  private constructor(
    engine: WasmEngine,
    config: BoardConfig,
    opts: {
      restoredWithAnalysis: boolean;
      baseMoves: string;
      baseMoveCount: number;
      baseTipNodeId: number;
      finalizedNodes: Map<number, [number, number][]>;
    },
  ) {
    this.engine = engine;
    this.config = config;
    this.komi = config.komi ?? 6.5;
    this.showCoords = config.showCoordinates ?? false;
    this.restoredWithAnalysis = opts.restoredWithAnalysis;
    this.baseMoves = opts.baseMoves;
    this.baseMoveCount = opts.baseMoveCount;
    this._baseTipNodeId = opts.baseTipNodeId;
    this.finalizedNodes = opts.finalizedNodes;
    this.finalizedTerritoryCache = new Map();
    this.abortController = new AbortController();
  }

  static async create(config: BoardConfig): Promise<BoardController> {
    const wasm = await ensureWasm();
    const engine = new wasm.WasmEngine(config.cols, config.rows);
    if (config.handicap && config.handicap >= 2) {
      engine.set_handicap(config.handicap);
    }

    let baseMoves = config.baseMoves ?? "[]";
    let baseMoveCount = (JSON.parse(baseMoves) as unknown[]).length;
    let baseTipNodeId = -1;
    let restoredWithAnalysis = false;

    const saved = config.storageKey ? storage.get(config.storageKey) : null;

    if (saved) {
      if (!engine.replace_tree(saved)) {
        engine.replace_moves(saved);
      }
      const savedBase = storage.get(`${config.storageKey}:base`);
      if (savedBase) {
        baseMoves = savedBase;
        baseMoveCount = (JSON.parse(savedBase) as unknown[]).length;
      }
      restoredWithAnalysis = engine.tree_node_count() > baseMoveCount;
      const savedNodeId = storage.get(`${config.storageKey}:node`);
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
      baseTipNodeId = baseMoveCount - 1;
      engine.to_latest();
    }

    const finalizedNodes = BoardController.loadFinalizedNodes(
      config.storageKey,
    );

    const ctrl = new BoardController(engine, config, {
      restoredWithAnalysis,
      baseMoves,
      baseMoveCount,
      baseTipNodeId,
      finalizedNodes,
    });

    ctrl.wireListeners();
    ctrl.render();
    return ctrl;
  }

  // ---- Storage helpers ----

  private static loadFinalizedNodes(
    storageKey?: string,
  ): Map<number, [number, number][]> {
    if (!storageKey) {
      return new Map();
    }
    const raw = storage.get(`${storageKey}:finalized`);
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

  private saveFinalizedNodes(): void {
    if (!this.config.storageKey) {
      return;
    }
    if (this.finalizedNodes.size === 0) {
      storage.remove(`${this.config.storageKey}:finalized`);
      return;
    }
    const data: Record<string, [number, number][]> = {};
    for (const [id, dead] of this.finalizedNodes) {
      data[String(id)] = dead;
    }
    storage.set(`${this.config.storageKey}:finalized`, JSON.stringify(data));
  }

  save(): void {
    if (this.config.storageKey) {
      storage.set(this.config.storageKey, this.engine.tree_json());
      storage.set(`${this.config.storageKey}:base`, this.baseMoves);
    }
  }

  // ---- Territory ----

  private buildOverlay(
    deadStones: [number, number][],
    ownership: number[],
  ): TerritoryOverlay {
    const size = this.engine.cols() * this.engine.rows();
    const paintMap: (number | null)[] = new Array(size);
    for (let i = 0; i < size; i++) {
      paintMap[i] = ownership[i] || null;
    }
    return { paintMap, dimmedVertices: deadStones };
  }

  private computeTerritoryState(
    deadStones: [number, number][],
  ): TerritoryState | undefined {
    try {
      const deadJson = JSON.stringify(deadStones);
      const ownership: number[] = JSON.parse(
        this.engine.estimate_territory(deadJson),
      );
      const scoreJson = this.engine.score(deadJson, this.komi);
      const parsed = JSON.parse(scoreJson);
      const score: ScoreData = {
        black: parsed.black,
        white: parsed.white,
      };
      return { deadStones, ownership, score };
    } catch {
      console.warn("Failed to compute territory state");
      return undefined;
    }
  }

  enterTerritoryReview(): void {
    let deadStones: [number, number][];
    try {
      deadStones = JSON.parse(this.engine.detect_dead_stones());
    } catch {
      console.warn("Failed to parse dead stones");
      return;
    }
    this.territoryState = this.computeTerritoryState(deadStones);
    this.render();
  }

  exitTerritoryReview(): void {
    this.territoryState = undefined;
    this.render();
  }

  finalizeTerritoryReview(): ScoreData | undefined {
    if (!this.territoryState) {
      return undefined;
    }
    const score = this.territoryState.score;
    const deadStones = this.territoryState.deadStones;
    const nodeId = this.engine.current_node_id();
    if (nodeId < 0) {
      return undefined;
    }
    this.finalizedNodes.set(nodeId, deadStones);
    this.saveFinalizedNodes();
    this.territoryState = undefined;
    this.save();
    this.render();
    return score;
  }

  markSettled(deadStones: [number, number][]): void {
    if (this._baseTipNodeId < 0) {
      return;
    }
    this.finalizedNodes.set(this._baseTipNodeId, deadStones);
    this.saveFinalizedNodes();
  }

  isTerritoryReview(): boolean {
    return !!this.territoryState;
  }

  isFinalized(): boolean {
    const nodeId = this.engine.current_node_id();
    return nodeId >= 0 && this.finalizedNodes.has(nodeId);
  }

  // ---- Rendering ----

  private resolveTreeDirection(): "horizontal" | "vertical" | undefined {
    if (this.config.moveTreeDirection === "responsive") {
      return window.innerWidth < DESKTOP_BREAKPOINT ? "horizontal" : "vertical";
    }
    return this.config.moveTreeDirection;
  }

  private renderBoard(): TerritoryInfo {
    const nodeId = this.engine.current_node_id();
    const finalized = nodeId >= 0 && this.finalizedNodes.has(nodeId);

    let overlay: TerritoryOverlay | undefined;
    let territoryInfo: TerritoryInfo;

    if (finalized) {
      let ts = this.finalizedTerritoryCache.get(nodeId);
      if (!ts) {
        const deadStones = this.finalizedNodes.get(nodeId)!;
        ts = this.computeTerritoryState(deadStones);
        if (ts) {
          this.finalizedTerritoryCache.set(nodeId, ts);
        }
      }
      if (ts) {
        overlay = this.buildOverlay(ts.deadStones, ts.ownership);
        territoryInfo = {
          reviewing: false,
          finalized: true,
          score: ts.score,
        };
      } else {
        territoryInfo = {
          reviewing: false,
          finalized: false,
          score: undefined,
        };
      }
    } else if (this.territoryState) {
      overlay = this.buildOverlay(
        this.territoryState.deadStones,
        this.territoryState.ownership,
      );
      territoryInfo = {
        reviewing: true,
        finalized: false,
        score: this.territoryState.score,
      };
    } else if (this.config.territoryOverlay && this.engine.is_at_latest()) {
      const serverOverlay = this.config.territoryOverlay();
      if (serverOverlay) {
        overlay = serverOverlay;
        territoryInfo = {
          reviewing: true,
          finalized: false,
          score: undefined,
        };
      } else {
        territoryInfo = {
          reviewing: false,
          finalized: false,
          score: undefined,
        };
      }
    } else {
      territoryInfo = {
        reviewing: false,
        finalized: false,
        score: undefined,
      };
    }

    const onVertexClick = (_: Event, [col, row]: Point) => {
      if (finalized) {
        return;
      }

      if (this.territoryState) {
        let newDead: [number, number][];
        try {
          const deadJson = this.engine.toggle_dead_chain(
            col,
            row,
            JSON.stringify(this.territoryState.deadStones),
          );
          newDead = JSON.parse(deadJson);
        } catch {
          console.warn("Failed to toggle dead chain");
          return;
        }
        this.territoryState = this.computeTerritoryState(newDead);
        this.render();
        return;
      }

      if (this.config.onVertexClick && this.config.onVertexClick(col, row)) {
        return;
      }
      if (this.engine.try_play(col, row)) {
        this.config.onStonePlay?.();
        this.save();
        this.render();
      }
    };

    const canPlay = !finalized && !overlay && (this.config.canPlay?.() ?? true);
    const crosshairStone = canPlay ? this.engine.current_turn_stone() : 0;

    renderFromEngine(
      this.engine,
      this.config.gobanEl,
      onVertexClick,
      overlay,
      this.showCoords,
      this.config.ghostStone,
      crosshairStone,
    );

    return territoryInfo;
  }

  render(): void {
    const territoryInfo = this.renderBoard();

    if (this.config.moveTreeEl) {
      const branchId =
        this.config.branchAtBaseTip && this._baseTipNodeId >= 0
          ? this._baseTipNodeId
          : undefined;
      renderMoveTree(
        this.engine,
        this.config.moveTreeEl,
        () => this.render(),
        this.resolveTreeDirection(),
        branchId,
      );
    }

    if (this.config.storageKey) {
      storage.set(
        `${this.config.storageKey}:node`,
        String(this.engine.current_node_id()),
      );
    }

    this.config.onRender?.(this.engine, territoryInfo);
  }

  // ---- Navigation ----

  navigate(action: NavAction): void {
    if (this.territoryState) {
      this.territoryState = undefined;
    }
    if (navigateEngine(this.engine, action)) {
      const stage = this.engine.stage();
      const nodeId = this.engine.current_node_id();
      if (
        stage === GameStage.TerritoryReview &&
        !this.isFinalized() &&
        nodeId !== this._baseTipNodeId
      ) {
        this.enterTerritoryReview();
        return;
      }
      this.render();
    }
  }

  pass(): boolean {
    const stage = this.engine.stage();
    if (
      this.isFinalized() ||
      stage === GameStage.TerritoryReview ||
      stage === GameStage.Completed
    ) {
      return false;
    }
    if (this.territoryState) {
      this.territoryState = undefined;
    }
    if (this.engine.pass()) {
      this.config.onPass?.();
      this.save();
      flashPassEffect(this.config.gobanEl);
      if (this.engine.stage() === GameStage.TerritoryReview) {
        this.enterTerritoryReview();
        return true;
      }
      this.render();
      return true;
    }
    return false;
  }

  // ---- State updates ----

  updateBaseMoves(movesJson: string): void {
    const newCount = (JSON.parse(movesJson) as unknown[]).length;
    const oldTipId = this._baseTipNodeId;
    const wasAtBaseTip =
      oldTipId < 0 || this.engine.current_node_id() === oldTipId;

    if (newCount !== this.baseMoveCount) {
      // Incremental: merge into existing tree (preserves analysis branches)
      const newTipId = this.engine.merge_base_moves(movesJson);
      this._baseTipNodeId = newTipId;

      // Undo: prune the undone move(s) from the tree
      if (
        newCount < this.baseMoveCount &&
        oldTipId >= 0 &&
        oldTipId !== newTipId
      ) {
        this.engine.remove_subtree(oldTipId);
      }

      // Auto-navigate to new tip if user was watching live play
      if (wasAtBaseTip) {
        this.engine.to_latest();
      }
    } else {
      // Same length, different content — full replace (rare: e.g. reconnect glitch)
      invalidateTreeCache();
      this.engine.replace_moves(movesJson);
      this._baseTipNodeId = newCount > 0 ? newCount - 1 : -1;
    }

    this.baseMoves = movesJson;
    this.baseMoveCount = newCount;
  }

  setShowCoordinates(show: boolean): void {
    this.showCoords = show;
    this.renderBoard();
  }

  setMoveTreeEl(el: HTMLElement | null): void {
    this.config.moveTreeEl = el;
    if (!this.config.moveTreeDirection) {
      this.config.moveTreeDirection = "responsive";
    }
  }

  private reset(): void {
    if (this.config.storageKey) {
      storage.remove(this.config.storageKey);
      storage.remove(`${this.config.storageKey}:base`);
      storage.remove(`${this.config.storageKey}:finalized`);
      storage.remove(`${this.config.storageKey}:node`);
    }
    this.territoryState = undefined;
    this.finalizedNodes = new Map();
    this.finalizedTerritoryCache = new Map();
    invalidateTreeCache();
    this.engine.replace_moves(this.baseMoves);
    this.engine.to_latest();
    this.render();
  }

  exportSnapshot(): string {
    const snapshot: PresentationSnapshot = {
      tree: this.engine.tree_json(),
      activeNodeId: String(this.engine.current_node_id()),
    };
    if (this.territoryState) {
      const flat = this.territoryState.ownership;
      const deadFlat = this.territoryState.deadStones.map(
        ([c, r]) => r * this.engine.cols() + c,
      );
      snapshot.territory = {
        ownership: flat,
        deadStones: deadFlat,
        score: {
          black:
            (this.territoryState.score?.black.territory ?? 0) +
            (this.territoryState.score?.black.captures ?? 0),
          white:
            (this.territoryState.score?.white.territory ?? 0) +
            (this.territoryState.score?.white.captures ?? 0),
        },
      };
    }
    return JSON.stringify(snapshot);
  }

  importSnapshot(json: string): void {
    if (!json) {
      return;
    }
    let snapshot: PresentationSnapshot;
    try {
      snapshot = JSON.parse(json);
    } catch {
      console.warn("Failed to parse presentation snapshot");
      return;
    }
    if (snapshot.tree) {
      this.engine.replace_tree(snapshot.tree);
    }
    const nodeId = parseInt(snapshot.activeNodeId, 10);
    if (nodeId >= 0) {
      this.engine.navigate_to(nodeId);
    } else {
      this.engine.to_start();
    }
    if (snapshot.territory) {
      const cols = this.engine.cols();
      const deadStones: [number, number][] = snapshot.territory.deadStones.map(
        (idx) => [idx % cols, Math.floor(idx / cols)] as [number, number],
      );
      this.territoryState = {
        deadStones,
        ownership: snapshot.territory.ownership,
        score: undefined,
      };
    } else {
      this.territoryState = undefined;
    }
    this.render();
  }

  destroy(): void {
    this.abortController.abort();
  }

  // ---- Listeners ----

  private wireListeners(): void {
    const opts = { signal: this.abortController.signal };

    document.addEventListener(
      "keydown",
      (e: KeyboardEvent) => {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
          return;
        }
        switch (e.key) {
          case "ArrowLeft":
            e.preventDefault();
            this.navigate("back");
            break;
          case "ArrowRight":
            e.preventDefault();
            this.navigate("forward");
            break;
          case "Home":
            e.preventDefault();
            this.navigate("start");
            break;
          case "End":
            e.preventDefault();
            this.navigate("end");
            break;
        }
      },
      opts,
    );

    window.addEventListener("resize", () => this.render(), opts);
  }
}

// ---------------------------------------------------------------------------
// Factory (preserves existing API)
// ---------------------------------------------------------------------------

export async function createBoard(config: BoardConfig): Promise<Board> {
  return BoardController.create(config);
}
