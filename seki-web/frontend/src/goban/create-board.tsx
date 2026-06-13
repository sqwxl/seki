import { flashPassEffect } from "../game/messages";
import {
  GameStage,
  type PresentationSnapshot,
  type ScoreData,
} from "../game/types";
import { storage } from "../utils/storage";
import { ensureWasm, type TerritoryOverlay } from "./init-wasm";
import {
  invalidateTreeCache,
  navigateEngine,
  renderFromEngine,
  renderMoveTree,
  type NavAction,
} from "./render-board";
import type { GhostStoneData, HeatData, Point } from "./types";
import type { WasmEngine } from "/static/wasm/go_engine_wasm.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TerritoryInfo = {
  estimating: boolean;
  reviewing: boolean;
  confirming: boolean;
  finalized: boolean;
  score: ScoreData | undefined;
};

type GhostStoneGetter = () =>
  | { col: number; row: number; sign: import("./types").Sign }
  | undefined;

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
  ghostStoneOverlay?: () => (GhostStoneData | null)[] | undefined;
  territoryReviewOwnership?: () => number[] | undefined;
  territoryOverlay?: () => TerritoryOverlay | undefined;
  heatOverlay?: () => (HeatData | null)[] | undefined;
  onRender?: (engine: WasmEngine, territory: TerritoryInfo) => void;
  onNavigate?: () => void;
  canPlay?: () => boolean;
  onVertexClick?: (col: number, row: number) => boolean;
  onStonePlay?: () => void;
  onPass?: () => void;
  onTerritoryReviewStart?: () => boolean;
};

export type Board = {
  engine: WasmEngine;
  baseTipNodeId: number;
  restoredWithAnalysis: boolean;
  save: () => void;
  render: () => void;
  renderBoardOnly: () => void;
  playMove: (col: number, row: number) => boolean;
  undoMove: () => boolean;
  pass: () => boolean;
  navigate: (action: NavAction) => void;
  navigateBoardOnly: (action: NavAction) => void;
  updateBaseMoves: (movesJson: string) => void;
  restoreBaseMoves: () => void;
  setHandicap: (handicap: number) => void;
  setKomi: (komi: number) => void;
  setShowCoordinates: (show: boolean) => void;
  setMoveTreeEl: (el: HTMLElement | null) => void;
  setPassiveOverlay: (overlay: TerritoryOverlay | undefined) => void;
  enterEstimate: () => void;
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

export {
  computeVertexSize,
  ensureWasm,
  type TerritoryOverlay,
} from "./init-wasm";
export { type NavAction } from "./render-board";

// ---------------------------------------------------------------------------
// BoardController — implements Board
// ---------------------------------------------------------------------------

type TerritoryState = {
  deadStones: [number, number][];
  ownership: number[];
  score: ScoreData | undefined;
  mode: "estimate" | "review";
  readonly?: boolean;
};

class BoardController implements Board {
  readonly engine: WasmEngine;
  readonly restoredWithAnalysis: boolean;

  private config: BoardConfig;
  private handicap: number;
  private komi: number;
  private showCoords: boolean;
  private baseMoves: string;
  private baseMoveCount: number;
  private _baseTipNodeId: number;
  private territoryState: TerritoryState | undefined;
  private passiveOverlay: TerritoryOverlay | undefined;
  private finalizedNodes: Map<number, [number, number][]>;
  private finalizedTerritoryCache: Map<number, TerritoryState>;
  private abortController: AbortController;
  private resizeFrame: number | undefined;

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
    this.handicap = config.handicap ?? 0;
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
    mode: TerritoryState["mode"],
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

      return { deadStones, ownership, score, mode };
    } catch {
      console.warn("Failed to compute territory state");

      return undefined;
    }
  }

  private computeExternalTerritoryState(
    mode: TerritoryState["mode"],
  ): TerritoryState | undefined {
    const ownership = this.config.territoryReviewOwnership?.();
    const cols = this.engine.cols();
    const rows = this.engine.rows();
    const size = cols * rows;

    if (!ownership || ownership.length !== size) {
      return undefined;
    }

    const board = [...this.engine.board()] as number[];
    const deadStones: [number, number][] = [];

    for (let index = 0; index < size; index++) {
      const stone = board[index] ?? 0;
      const owner = ownership[index] ?? 0;

      if (stone !== 0 && owner !== 0 && Math.sign(stone) !== Math.sign(owner)) {
        deadStones.push([index % cols, Math.floor(index / cols)]);
      }
    }

    return {
      deadStones,
      ownership,
      score: undefined,
      mode,
      readonly: mode === "estimate",
    };
  }

  enterEstimate(): void {
    const externalState = this.computeExternalTerritoryState("estimate");

    if (externalState) {
      this.setPassiveOverlay(
        this.buildOverlay(externalState.deadStones, externalState.ownership),
      );

      return;
    }

    let deadStones: [number, number][];

    try {
      deadStones = JSON.parse(this.engine.detect_dead_stones());
    } catch {
      console.warn("Failed to parse dead stones");

      return;
    }
    const state = this.computeTerritoryState(deadStones, "estimate");

    if (!state) {
      return;
    }

    this.setPassiveOverlay(
      this.buildOverlay(state.deadStones, state.ownership),
    );
  }

  setPassiveOverlay(overlay: TerritoryOverlay | undefined): void {
    this.passiveOverlay = overlay;
    this.renderBoardOnly();
  }

  enterTerritoryReview(): void {
    const externalState = this.computeExternalTerritoryState("review");

    if (externalState) {
      this.territoryState = externalState;
      this.render();

      return;
    }

    let deadStones: [number, number][];

    try {
      deadStones = JSON.parse(this.engine.detect_dead_stones());
    } catch {
      console.warn("Failed to parse dead stones");

      return;
    }
    this.territoryState = this.computeTerritoryState(deadStones, "review");
    this.render();
  }

  exitTerritoryReview(): void {
    this.territoryState = undefined;
    this.passiveOverlay = undefined;
    this.render();
  }

  finalizeTerritoryReview(): ScoreData | undefined {
    if (!this.territoryState) {
      return undefined;
    }

    if (this.territoryState.readonly) {
      this.territoryState = undefined;
      this.render();

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
    return this.config.moveTreeDirection === "responsive"
      ? undefined
      : this.config.moveTreeDirection;
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
        ts = this.computeTerritoryState(deadStones, "review");

        if (ts) {
          this.finalizedTerritoryCache.set(nodeId, ts);
        }
      }

      if (ts) {
        overlay = this.buildOverlay(ts.deadStones, ts.ownership);
        territoryInfo = {
          estimating: false,
          reviewing: false,
          confirming: false,
          finalized: true,
          score: ts.score,
        };
      } else {
        territoryInfo = {
          reviewing: false,
          estimating: false,
          confirming: false,
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
        estimating: false,
        reviewing: true,
        confirming: this.territoryState.mode === "review",
        finalized: false,
        score: this.territoryState.score,
      };
    } else if (this.config.territoryOverlay && this.engine.is_at_latest()) {
      const serverOverlay = this.config.territoryOverlay();

      if (serverOverlay) {
        overlay = serverOverlay;
        territoryInfo = {
          reviewing: true,
          estimating: false,
          confirming: true,
          finalized: false,
          score: undefined,
        };
      } else if (this.passiveOverlay) {
        overlay = this.passiveOverlay;
        territoryInfo = {
          estimating: true,
          reviewing: false,
          confirming: false,
          finalized: false,
          score: undefined,
        };
      } else {
        territoryInfo = {
          reviewing: false,
          estimating: false,
          confirming: false,
          finalized: false,
          score: undefined,
        };
      }
    } else if (this.passiveOverlay) {
      overlay = this.passiveOverlay;
      territoryInfo = {
        estimating: true,
        reviewing: false,
        confirming: false,
        finalized: false,
        score: undefined,
      };
    } else {
      territoryInfo = {
        estimating: false,
        reviewing: false,
        confirming: false,
        finalized: false,
        score: undefined,
      };
    }

    const onVertexClick = (_: Event, [col, row]: Point) => {
      if (this.territoryState && !finalized) {
        if (this.territoryState.readonly) {
          this.territoryState = undefined;
        } else {
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

          this.territoryState = this.computeTerritoryState(
            newDead,
            this.territoryState.mode,
          );
          this.render();
          return;
        }
      }

      if (this.config.onVertexClick && this.config.onVertexClick(col, row)) {
        return;
      }

      this.playStone(col, row);
    };

    const overlayBlocksPlay = !!overlay && overlay !== this.passiveOverlay;
    const canPlay =
      (!overlayBlocksPlay || finalized) && (this.config.canPlay?.() ?? true);
    const crosshairStone = canPlay ? this.engine.current_turn_stone() : 0;

    renderFromEngine(
      this.engine,
      this.config.gobanEl,
      onVertexClick,
      overlay,
      this.showCoords,
      this.config.ghostStone,
      this.config.ghostStoneOverlay?.(),
      crosshairStone,
      this.config.heatOverlay?.(),
    );

    return territoryInfo;
  }

  render(): void {
    const territoryInfo = this.renderBoard();

    if (this.config.moveTreeEl) {
      renderMoveTree(
        this.engine,
        this.config.moveTreeEl,
        () => {
          this.config.onNavigate?.();
          this.render();
        },
        this.resolveTreeDirection(),
        this.config.branchAtBaseTip && this._baseTipNodeId >= 0
          ? this._baseTipNodeId
          : undefined,
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

  renderBoardOnly(): void {
    const territoryInfo = this.renderBoard();

    this.config.onRender?.(this.engine, territoryInfo);
  }

  private playStone(col: number, row: number): boolean {
    const oldTreeNodeCount = this.engine.tree_node_count();

    if (!this.engine.try_play(col, row)) {
      return false;
    }

    this.passiveOverlay = undefined;
    if (this.engine.tree_node_count() > oldTreeNodeCount) {
      this.config.onStonePlay?.();
    }
    this.save();
    this.render();

    return true;
  }

  playMove(col: number, row: number): boolean {
    return this.playStone(col, row);
  }

  undoMove(): boolean {
    if (!this.engine.undo()) {
      return false;
    }

    this.territoryState = undefined;
    this.passiveOverlay = undefined;
    this.save();
    this.render();

    return true;
  }

  // ---- Navigation ----

  navigate(action: NavAction): void {
    if (this.territoryState) {
      this.territoryState = undefined;
    }
    this.passiveOverlay = undefined;

    if (navigateEngine(this.engine, action)) {
      const stage = this.engine.stage();
      const nodeId = this.engine.current_node_id();

      this.config.onNavigate?.();

      if (
        stage === GameStage.TerritoryReview &&
        !this.isFinalized() &&
        nodeId !== this._baseTipNodeId
      ) {
        if (this.config.onTerritoryReviewStart?.()) {
          return;
        }

        this.enterTerritoryReview();

        return;
      }

      this.render();
    }
  }

  navigateBoardOnly(action: NavAction): void {
    if (this.territoryState) {
      this.territoryState = undefined;
    }
    this.passiveOverlay = undefined;

    if (navigateEngine(this.engine, action)) {
      this.config.onNavigate?.();
      this.renderBoardOnly();
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
    this.passiveOverlay = undefined;

    const oldTreeNodeCount = this.engine.tree_node_count();

    if (this.engine.pass()) {
      if (this.engine.tree_node_count() > oldTreeNodeCount) {
        this.config.onPass?.();
      }
      this.save();
      flashPassEffect(this.config.gobanEl);

      if (this.engine.stage() === GameStage.TerritoryReview) {
        if (this.config.onTerritoryReviewStart?.()) {
          return true;
        }

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
    this.passiveOverlay = undefined;
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
        this.engine.to_main_end();
      }
    } else if (newCount > 0) {
      // Same length, different content — merge so analysis branches survive
      invalidateTreeCache();
      const newTipId = this.engine.merge_base_moves(movesJson);
      this._baseTipNodeId = newTipId;

      if (wasAtBaseTip) {
        this.engine.to_main_end();
      }
    } else {
      invalidateTreeCache();
      this._baseTipNodeId = -1;

      if (wasAtBaseTip) {
        this.engine.to_start();
      }
    }

    this.baseMoves = movesJson;
    this.baseMoveCount = newCount;
  }

  restoreBaseMoves(): void {
    this.territoryState = undefined;
    this.passiveOverlay = undefined;
    invalidateTreeCache();
    this.engine.replace_moves(this.baseMoves);
    this._baseTipNodeId = this.baseMoveCount > 0 ? this.baseMoveCount - 1 : -1;
    this.engine.to_latest();
  }

  setHandicap(handicap: number): void {
    if (handicap === this.handicap) {
      return;
    }

    this.handicap = handicap;
    this.territoryState = undefined;
    this.passiveOverlay = undefined;
    invalidateTreeCache();
    this.engine.set_handicap(handicap);
  }

  setKomi(komi: number): void {
    this.komi = komi;
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
    this.passiveOverlay = undefined;
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
        mode: "review",
      };
    } else {
      this.territoryState = undefined;
    }
    this.passiveOverlay = undefined;

    this.render();
  }

  destroy(): void {
    if (this.resizeFrame !== undefined) {
      cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = undefined;
    }

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
          case "ArrowUp":
          case "Home":
            e.preventDefault();
            this.navigate("start");

            break;
          case "ArrowDown":
          case "End":
            e.preventDefault();
            this.navigate("end");

            break;
        }
      },
      opts,
    );

    window.addEventListener(
      "resize",
      () => {
        if (this.resizeFrame !== undefined) {
          return;
        }

        this.resizeFrame = requestAnimationFrame(() => {
          this.resizeFrame = undefined;
          this.render();
        });
      },
      opts,
    );
  }
}

// ---------------------------------------------------------------------------
// Factory (preserves existing API)
// ---------------------------------------------------------------------------

export async function createBoard(config: BoardConfig): Promise<Board> {
  return BoardController.create(config);
}
