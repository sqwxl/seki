import { beforeEach, describe, expect, it, vi } from "vitest";
import { GameStage } from "../game/types";
import { createBoard } from "../goban/create-board";
import { renderFromEngine } from "../goban/render-board";

const tryPlay = vi.fn<(col: number, row: number) => boolean>(() => true);
let nodeCount = 1;
let nodeId = -1;

class MockWasmEngine {
  cols() {
    return 9;
  }

  rows() {
    return 9;
  }

  board() {
    return Array(81).fill(0);
  }

  current_node_id() {
    return nodeId;
  }

  current_turn_stone() {
    return 1;
  }

  is_at_latest() {
    return true;
  }

  tree_node_count() {
    return nodeCount;
  }

  try_play(col: number, row: number) {
    const ok = tryPlay(col, row);

    if (ok) {
      nodeCount += 1;
      nodeId += 1;
    }

    return ok;
  }

  tree_json() {
    return "[]";
  }

  set_handicap() {}
  replace_tree() {
    return false;
  }
  replace_moves() {}
  to_latest() {}
  stage() {
    return GameStage.BlackToPlay;
  }
}

vi.mock("../goban/init-wasm", () => ({
  computeVertexSize: () => 24,
  desktopMQ: { matches: false },
  ensureWasm: async () => ({
    default: vi.fn(),
    WasmEngine: MockWasmEngine,
  }),
}));

vi.mock("../goban/render-board", () => ({
  invalidateTreeCache: vi.fn(),
  navigateEngine: vi.fn(),
  renderFromEngine: vi.fn(),
  renderMoveTree: vi.fn(),
}));

beforeEach(() => {
  localStorage.clear();
  tryPlay.mockReturnValue(true);
  nodeCount = 1;
  nodeId = -1;
  vi.clearAllMocks();
  globalThis.document.addEventListener = vi.fn();
});

describe("BoardController.playMove", () => {
  it("uses the normal play path for public bot moves", async () => {
    const onStonePlay = vi.fn();
    const onRender = vi.fn();
    const board = await createBoard({
      cols: 9,
      rows: 9,
      gobanEl: {} as HTMLDivElement,
      storageKey: "board-test",
      onStonePlay,
      onRender,
    });

    vi.clearAllMocks();

    expect(board.playMove(3, 4)).toBe(true);
    expect(tryPlay).toHaveBeenCalledWith(3, 4);
    expect(onStonePlay).toHaveBeenCalledOnce();
    expect(renderFromEngine).toHaveBeenCalledOnce();
    expect(onRender).toHaveBeenCalledOnce();
    expect(localStorage.getItem("board-test")).toBe("[]");
  });

  it("returns false without rendering when the engine rejects the move", async () => {
    const onStonePlay = vi.fn();
    const board = await createBoard({
      cols: 9,
      rows: 9,
      gobanEl: {} as HTMLDivElement,
      onStonePlay,
    });

    tryPlay.mockReturnValue(false);
    vi.clearAllMocks();

    expect(board.playMove(0, 0)).toBe(false);
    expect(onStonePlay).not.toHaveBeenCalled();
    expect(renderFromEngine).not.toHaveBeenCalled();
  });

  it("clears passive overlays before rendering the played move", async () => {
    const board = await createBoard({
      cols: 9,
      rows: 9,
      gobanEl: {} as HTMLDivElement,
    });

    board.setPassiveOverlay({
      paintMap: Array(81).fill(null),
      dimmedVertices: [[0, 0]],
    });
    vi.clearAllMocks();

    board.playMove(4, 4);

    expect(vi.mocked(renderFromEngine).mock.calls[0][3]).toBeUndefined();
  });
});
