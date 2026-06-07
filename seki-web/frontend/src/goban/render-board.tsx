import { render } from "preact";
import { MoveTree } from "../components/move-tree";
import type { GameTreeData } from "../game/types";
import { Goban } from "./";
import { computeVertexSize, desktopMQ, koMarker } from "./init-wasm";
import type {
  GhostStoneData,
  HeatData,
  MarkerData,
  Point,
  Sign,
} from "./types";
import type { WasmEngine } from "/static/wasm/go_engine_wasm.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type GhostStoneGetter = () =>
  | { col: number; row: number; sign: Sign }
  | undefined;

function renderFromEngine(
  engine: WasmEngine,
  gobanEl: HTMLElement,
  onVertexClick?: (evt: Event, position: Point) => void,
  overlay?: import("./init-wasm").TerritoryOverlay,
  showCoordinates?: boolean,
  ghostStone?: GhostStoneGetter,
  ghostStoneOverlay?: (GhostStoneData | null)[],
  crosshairStone?: number,
  heatMap?: (HeatData | null)[],
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

  let ghostStoneMap = ghostStoneOverlay;

  if (ghostStone) {
    const gs = ghostStone();

    if (gs) {
      ghostStoneMap = ghostStoneMap
        ? [...ghostStoneMap]
        : Array(board.length).fill(null);
      ghostStoneMap![gs.row * cols + gs.col] = { sign: gs.sign };
    }
  }

  // Reset inline --col-width so we measure against the CSS default.
  // On desktop the post-render code below sets it to the rendered board width;
  // clearing it first lets the container shrink to the CSS-defined size.
  // This is also needed when crossing from desktop → mobile: the stale inline
  // pixel value would otherwise override the mobile CSS default.
  const body = gobanEl.closest(".game-page-body") as HTMLElement | null;

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
      heatMap={heatMap}
      dimmedVertices={overlay?.dimmedVertices}
      showCoordinates={showCoordinates}
      fuzzyStonePlacement
      animateStonePlacement
      onVertexClick={onVertexClick}
      crosshairStone={crosshairStone}
    />,
    gobanEl,
  );

  // Sync --col-width to the rendered board width (desktop only — on mobile
  // the CSS default min(90vw, 70vh) handles sizing)
  if (desktopMQ.matches && body) {
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
  mainLineTipNodeId?: number,
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
      direction={direction}
      mainLineTipNodeId={mainLineTipNodeId}
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

export { navigateEngine, renderFromEngine, renderMoveTree };
