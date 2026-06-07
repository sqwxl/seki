import { signal } from "@preact/signals";
import { describe, expect, it, vi } from "vitest";
import { onRenderCallback } from "../layouts/live-game/board-section";

function renderLivePosition({
  baseTipNodeId,
  currentNodeId,
  viewIndex,
  moveCount,
  presentationActive = false,
  isPresenter = false,
}: {
  baseTipNodeId: number;
  currentNodeId: number;
  viewIndex: number;
  moveCount: number;
  presentationActive?: boolean;
  isPresenter?: boolean;
}) {
  const enterAnalysis = vi.fn();
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

  onRenderCallback(
    engine as never,
    {
      estimating: false,
      reviewing: false,
      confirming: false,
      finalized: false,
      score: undefined,
    },
    {
      board: signal({ baseTipNodeId } as never),
      analysisMode: signal(false),
      estimateMode: signal(false),
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
      exitEstimateFn: vi.fn(),
      enterEstimateFn: vi.fn(),
    },
  );

  return { enterAnalysis, navState };
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
});
