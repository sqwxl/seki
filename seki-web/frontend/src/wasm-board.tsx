import { render } from "preact";
import { Goban } from "./goban/index";
import type { GameTreeData, MarkerData, Point } from "./goban/types";
import { MoveTree } from "./move-tree";
import type { WasmEngine } from "/static/wasm/go_engine_wasm.js";

const koMarker: MarkerData = { type: "triangle", label: "ko" };

let wasmModule: typeof import("/static/wasm/go_engine_wasm.js") | undefined;

async function ensureWasm(): Promise<
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
): number {
  const avail = gobanEl.clientWidth;
  const extra = 0.8;
  return Math.max(avail / (Math.max(cols, rows) + extra), 12);
}

function renderFromEngine(
  engine: WasmEngine,
  gobanEl: HTMLElement,
  onVertexClick?: (evt: Event, position: Point) => void,
): void {
  const board = [...engine.board()] as number[];
  const cols = engine.cols();
  const rows = engine.rows();
  const markerMap: (MarkerData | null)[] = Array(board.length).fill(null);

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

  render(
    <Goban
      cols={cols}
      rows={rows}
      vertexSize={computeVertexSize(gobanEl, cols, rows)}
      signMap={board}
      markerMap={markerMap}
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
): void {
  const treeJson = engine.tree_json();
  const tree: GameTreeData = JSON.parse(treeJson);
  const currentNodeId = engine.current_node_id();

  render(
    <MoveTree
      tree={tree}
      currentNodeId={currentNodeId}
      onNavigate={(nodeId) => {
        engine.navigate_to(nodeId);
        doRender();
      }}
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

export type BoardConfig = {
  cols: number;
  rows: number;
  gobanEl: HTMLElement;
  moveTreeEl?: HTMLElement | null;
  storageKey?: string;
  baseMoves?: string;
  navButtons?: NavButtons;
  buttons?: {
    undo?: HTMLButtonElement | null;
    pass?: HTMLButtonElement | null;
    reset?: HTMLButtonElement | null;
  };
  onRender?: (engine: WasmEngine) => void;
  onVertexClick?: (col: number, row: number) => boolean;
};

export type Board = {
  engine: WasmEngine;
  render: () => void;
  navigate: (action: NavAction) => void;
  updateBaseMoves: (movesJson: string, replaceEngine?: boolean) => void;
  updateNav: () => void;
  destroy: () => void;
};

export async function createBoard(config: BoardConfig): Promise<Board> {
  const wasm = await ensureWasm();
  const engine = new wasm.WasmEngine(config.cols, config.rows);

  // Base moves the board can be reset to (e.g. game moves from WS)
  let baseMoves = config.baseMoves ?? "[]";

  // Initialize from localStorage or baseMoves
  const saved = config.storageKey
    ? localStorage.getItem(config.storageKey)
    : null;
  if (saved) {
    // Try restoring a tree first, fall back to flat moves
    if (!engine.replace_tree(saved)) {
      engine.replace_moves(saved);
    }
    engine.to_latest();
  } else if (baseMoves !== "[]") {
    engine.replace_moves(baseMoves);
    engine.to_latest();
  }

  function save() {
    if (config.storageKey) {
      localStorage.setItem(config.storageKey, engine.tree_json());
    }
  }

  function doRender() {
    const onVertexClick = (_: Event, [col, row]: Point) => {
      if (config.onVertexClick && config.onVertexClick(col, row)) {
        return;
      }
      if (engine.try_play(col, row)) {
        save();
        doRender();
      }
    };

    renderFromEngine(engine, config.gobanEl, onVertexClick);

    if (config.moveTreeEl) {
      renderMoveTree(engine, config.moveTreeEl, doRender);
    }

    if (config.navButtons) {
      updateNavButtons(engine, config.navButtons);
    }

    if (config.onRender) {
      config.onRender(engine);
    }
  }

  function doNavigate(action: NavAction) {
    if (navigateEngine(engine, action)) {
      doRender();
    }
  }

  function doUpdateBaseMoves(movesJson: string, replaceEngine = true) {
    baseMoves = movesJson;
    if (replaceEngine) {
      const wasAtLatest = engine.is_at_latest();
      engine.replace_moves(movesJson);
      if (wasAtLatest) {
        engine.to_latest();
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
        if (engine.pass()) {
          save();
          doRender();
        }
      },
      opts,
    );

    config.buttons.reset?.addEventListener(
      "click",
      () => {
        if (config.storageKey) {
          localStorage.removeItem(config.storageKey);
        }
        engine.replace_moves(baseMoves);
        engine.to_latest();
        doRender();
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
    render: doRender,
    navigate: doNavigate,
    updateBaseMoves: doUpdateBaseMoves,
    updateNav: doUpdateNav,
    destroy: () => abortController.abort(),
  };
}
