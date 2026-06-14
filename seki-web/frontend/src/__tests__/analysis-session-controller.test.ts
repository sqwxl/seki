import { signal } from "@preact/signals";
import { describe, expect, it, vi } from "vitest";
import type { Board, TerritoryInfo } from "../goban/create-board";
import {
  createAnalysisSessionController,
  type AnalysisAiState,
  type AnalysisEstimateState,
} from "../layouts/analysis-session/controller";
import type { MoveConfirmState } from "../utils/move-confirm";

function territoryInfo(overrides: Partial<TerritoryInfo> = {}): TerritoryInfo {
  return {
    estimating: false,
    reviewing: false,
    confirming: false,
    finalized: false,
    score: undefined,
    ...overrides,
  };
}

function moveConfirm(value?: [number, number]): MoveConfirmState {
  return {
    value,
    enabled: true,
    getGhostStone: () => undefined,
    clear: vi.fn(function (this: MoveConfirmState) {
      this.value = undefined;
    }),
  };
}

function mockBoard(options: { size?: number } = {}) {
  let nodeId = 0;
  let treeNodeCount = 1;
  const size = options.size ?? 19;
  const engine = {
    board: () => Array(size * size).fill(0),
    captures_black: () => 0,
    captures_white: () => 0,
    cols: () => size,
    current_node_id: () => nodeId,
    current_turn_stone: () => 1,
    has_ko: () => false,
    ko_col: () => -1,
    ko_row: () => -1,
    is_at_latest: () => true,
    is_at_main_end: () => true,
    is_at_start: () => nodeId < 0,
    is_legal: () => true,
    last_move_was_pass: () => false,
    moves_json: () => "[]",
    rows: () => size,
    stage: () => "black_to_play",
    tree_node_count: () => treeNodeCount,
    try_play: vi.fn(() => {
      nodeId += 1;
      treeNodeCount += 1;

      return true;
    }),
    view_index: () => Math.max(0, nodeId + 1),
  };
  const board: Board = {
    baseTipNodeId: -1,
    destroy: vi.fn(),
    engine,
    enterEstimate: vi.fn(),
    enterTerritoryReview: vi.fn(),
    exitTerritoryReview: vi.fn(),
    exportSnapshot: vi.fn(),
    finalizeTerritoryReview: vi.fn(),
    importSnapshot: vi.fn(),
    isFinalized: vi.fn(() => false),
    isTerritoryReview: vi.fn(() => false),
    markSettled: vi.fn(),
    navigate: vi.fn(),
    pass: vi.fn(),
    playMove: vi.fn(),
    render: vi.fn(),
    renderBoardOnly: vi.fn(),
    restoreBaseMoves: vi.fn(),
    restoredWithAnalysis: false,
    save: vi.fn(),
    setHandicap: vi.fn(),
    setKomi: vi.fn(),
    setMoveTreeEl: vi.fn(),
    setPassiveOverlay: vi.fn(),
    setShowCoordinates: vi.fn(),
    undoMove: vi.fn(),
    updateBaseMoves: vi.fn(),
  } as never;

  return {
    board,
    setNodeId: (next: number) => {
      nodeId = next;
    },
  };
}

function session(
  overrides: {
    board?: Board;
    estimate?: AnalysisEstimateState;
    ensureAiModel?: () => Promise<boolean>;
    canUseAi?: () => boolean;
    pendingMove?: [number, number];
  } = {},
) {
  const state = {
    ai: signal<AnalysisAiState>({ enabled: false, pending: false }),
    board: signal<Board | undefined>(overrides.board),
    estimate: signal<AnalysisEstimateState>(
      overrides.estimate ?? { pending: false },
    ),
    nav: signal({
      atStart: true,
      atLatest: true,
      atMainEnd: true,
      counter: "0",
      boardTurnStone: 1,
      boardLastMoveWasPass: false,
    }),
    pendingMove: signal(overrides.pendingMove),
    territoryInfo: signal(territoryInfo()),
  };
  const mc = moveConfirm(overrides.pendingMove);

  return {
    controller: createAnalysisSessionController({
      state,
      moveConfirm: mc,
      getKomi: () => 6.5,
      canUseAi: overrides.canUseAi ?? (() => false),
      ensureAiModel: overrides.ensureAiModel,
    }),
    mc,
    state,
  };
}

describe("analysis session controller", () => {
  it("keeps estimate active and refreshes it after node changes", () => {
    const { board, setNodeId } = mockBoard();
    const { controller, state } = session({
      board,
      estimate: { pending: false, mode: "estimate", nodeId: 0 },
    });

    controller.onRender(board.engine as never, territoryInfo());
    setNodeId(1);
    controller.onRender(board.engine as never, territoryInfo());

    expect(board.setPassiveOverlay).toHaveBeenCalledWith(undefined);
    expect(board.enterEstimate).toHaveBeenCalledOnce();
    expect(state.estimate.value.mode).toBe("estimate");
    expect(state.estimate.value.nodeId).toBe(1);
  });

  it("confirmed local moves use the shared board mutation path", () => {
    const { board } = mockBoard();
    const { controller, mc, state } = session({
      board,
      pendingMove: [3, 3],
    });

    controller.confirmPendingMove();

    expect(board.engine.try_play).toHaveBeenCalledWith(3, 3);
    expect(board.save).toHaveBeenCalledOnce();
    expect(board.render).toHaveBeenCalledOnce();
    expect(state.pendingMove.value).toBeUndefined();
    expect(mc.clear).toHaveBeenCalledOnce();
  });

  it("does not enable AI suggestion when model prompt is cancelled", async () => {
    const { board } = mockBoard({ size: 9 });
    const { controller, state } = session({
      board,
      canUseAi: () => true,
      ensureAiModel: async () => false,
    });

    controller.toggleAiSuggest();

    await flushAsync();

    expect(state.ai.value).toEqual({ enabled: false, pending: false });
    expect(board.renderBoardOnly).not.toHaveBeenCalled();
  });

  it("uses estimate fallback when model prompt is cancelled", async () => {
    const { board } = mockBoard({ size: 9 });
    const { controller, state } = session({
      board,
      canUseAi: () => true,
      ensureAiModel: async () => false,
    });

    await controller.startTerritoryOverlay("estimate");

    expect(state.estimate.value).toEqual({
      pending: false,
      mode: "estimate",
      nodeId: 0,
    });
    expect(board.enterEstimate).toHaveBeenCalledOnce();
  });
});

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
}
