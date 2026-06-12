import { signal } from "@preact/signals";
import { describe, expect, it, vi } from "vitest";
import { onRenderCallback } from "../layouts/live-game/board-section";

function renderLivePosition({
  baseTipNodeId,
  currentNodeId,
  viewIndex,
  moveCount,
  estimateMode = false,
  territoryInfo = {
    estimating: false,
    reviewing: false,
    confirming: false,
    finalized: false,
    score: undefined,
  },
  presentationActive = false,
  isPresenter = false,
}: {
  baseTipNodeId: number;
  currentNodeId: number;
  viewIndex: number;
  moveCount: number;
  estimateMode?: boolean;
  territoryInfo?: {
    estimating: boolean;
    reviewing: boolean;
    confirming: boolean;
    finalized: boolean;
    score: undefined;
  };
  presentationActive?: boolean;
  isPresenter?: boolean;
}) {
  const enterAnalysis = vi.fn();
  const exitEstimate = vi.fn();
  const navState = signal({
    atStart: false,
    atLatest: false,
    atMainEnd: false,
    counter: "0",
    boardTurnStone: 1,
    boardLastMoveWasPass: false,
  });
  const engine = {
    current_node_id: () => currentNodeId,
    view_index: () => viewIndex,
    is_at_start: () => currentNodeId < 0,
    is_at_latest: () => currentNodeId === baseTipNodeId,
    is_at_main_end: () => currentNodeId === baseTipNodeId,
    current_turn_stone: () => 1,
    last_move_was_pass: () => false,
  };

  onRenderCallback(engine as never, territoryInfo, {
    board: signal({ baseTipNodeId } as never),
    analysisMode: signal(false),
    estimateMode: signal(estimateMode),
    moves: signal(Array.from({ length: moveCount })),
    boardFinalized: signal(false),
    boardFinalizedScore: signal(undefined),
    boardReviewing: signal(false),
    estimateScore: signal(undefined),
    presentationActive: signal(presentationActive),
    isPresenter: signal(isPresenter),
    navState,
    broadcastSnapshot: vi.fn(),
    saveAnalysis: vi.fn(),
    enterAnalysis,
    exitEstimateFn: exitEstimate,
    enterEstimateFn: vi.fn(),
  });

  return { enterAnalysis, exitEstimate, navState };
}

describe("live game board render", () => {
  it("stays live at the exact server base tip", () => {
    const { enterAnalysis, navState } = renderLivePosition({
      baseTipNodeId: 89,
      currentNodeId: 89,
      viewIndex: 90,
      moveCount: 90,
    });

    expect(enterAnalysis).not.toHaveBeenCalled();
    expect(navState.value.counter).toBe("90");
  });

  it("leaves live mode when local analysis is ahead of server moves", () => {
    const { enterAnalysis } = renderLivePosition({
      baseTipNodeId: 89,
      currentNodeId: 92,
      viewIndex: 93,
      moveCount: 90,
    });

    expect(enterAnalysis).toHaveBeenCalledWith({
      restorePosition: false,
      nodeId: 92,
    });
  });

  it("allows synced presentation viewers away from the server base tip", () => {
    const { enterAnalysis } = renderLivePosition({
      baseTipNodeId: 89,
      currentNodeId: 92,
      viewIndex: 93,
      moveCount: 90,
      presentationActive: true,
      isPresenter: false,
    });

    expect(enterAnalysis).not.toHaveBeenCalled();
  });

  it("keeps live estimate open while a passive estimate overlay is rendered", () => {
    const { exitEstimate } = renderLivePosition({
      baseTipNodeId: 89,
      currentNodeId: 89,
      viewIndex: 90,
      moveCount: 90,
      estimateMode: true,
      territoryInfo: {
        estimating: true,
        reviewing: false,
        confirming: false,
        finalized: false,
        score: undefined,
      },
    });

    expect(exitEstimate).not.toHaveBeenCalled();
  });

  it("keeps live estimate open while a finalized overlay is rendered", () => {
    const { exitEstimate } = renderLivePosition({
      baseTipNodeId: 89,
      currentNodeId: 89,
      viewIndex: 90,
      moveCount: 90,
      estimateMode: true,
      territoryInfo: {
        estimating: false,
        reviewing: false,
        confirming: false,
        finalized: true,
        score: undefined,
      },
    });

    expect(exitEstimate).not.toHaveBeenCalled();
  });

  it("exits live estimate when no estimate overlay is rendered", () => {
    const { exitEstimate } = renderLivePosition({
      baseTipNodeId: 89,
      currentNodeId: 89,
      viewIndex: 90,
      moveCount: 90,
      estimateMode: true,
    });

    expect(exitEstimate).toHaveBeenCalledOnce();
  });
});
