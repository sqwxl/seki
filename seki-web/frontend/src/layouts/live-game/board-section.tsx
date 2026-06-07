import type { Signal } from "@preact/signals";
import type { Board, TerritoryInfo } from "../../goban/create-board";
import type { WasmEngine } from "/static/wasm/go_engine_wasm.js";

export function onRenderCallback(
  engine: WasmEngine,
  territoryInfo: TerritoryInfo,
  params: {
    board: Signal<Board | undefined>;
    analysisMode: Signal<boolean>;
    estimateMode: Signal<boolean>;
    moves: Signal<unknown[]>;
    boardFinalized: Signal<boolean>;
    boardFinalizedScore: Signal<unknown>;
    boardReviewing: Signal<boolean>;
    estimateScore: Signal<unknown>;
    presentationActive: Signal<boolean>;
    isPresenter: Signal<boolean>;
    navState: Signal<{
      atStart: boolean;
      atLatest: boolean;
      atMainEnd: boolean;
      counter: string;
      boardTurnStone: number;
      boardLastMoveWasPass: boolean;
    }>;
    broadcastSnapshot: () => void;
    saveAnalysis: () => void;
    enterAnalysis: (opts?: {
      restorePosition?: boolean;
      nodeId?: number;
    }) => void;
    exitEstimateFn: () => void;
    enterEstimateFn: () => void;
  },
): void {
  const {
    board,
    analysisMode,
    estimateMode,
    moves,
    boardFinalized,
    boardFinalizedScore,
    boardReviewing,
    estimateScore,
    presentationActive,
    isPresenter,
    navState,
    broadcastSnapshot,
    saveAnalysis,
    enterAnalysis,
    exitEstimateFn,
    enterEstimateFn,
  } = params;
  boardFinalized.value = territoryInfo.finalized;
  boardFinalizedScore.value = territoryInfo.finalized
    ? territoryInfo.score
    : undefined;
  boardReviewing.value = territoryInfo.confirming;

  if (
    estimateMode.value &&
    !analysisMode.value &&
    !territoryInfo.reviewing &&
    !territoryInfo.estimating
  ) {
    exitEstimateFn();
    estimateScore.value = undefined;
  }

  if (analysisMode.value && territoryInfo.reviewing && !estimateMode.value) {
    enterEstimateFn();
  }

  if (estimateMode.value && territoryInfo.score) {
    estimateScore.value = territoryInfo.score;
  }

  const currentNodeId = engine.current_node_id();
  const baseTipNodeId = board.value?.baseTipNodeId ?? -1;
  const viewIndex = engine.view_index();
  const atLiveTip =
    (baseTipNodeId >= 0
      ? currentNodeId === baseTipNodeId
      : currentNodeId < 0) && viewIndex === moves.value.length;

  if (
    board.value &&
    !analysisMode.value &&
    !estimateMode.value &&
    !atLiveTip &&
    !(presentationActive.value && !isPresenter.value)
  ) {
    enterAnalysis({
      restorePosition: false,
      nodeId: currentNodeId,
    });
  }

  if (presentationActive.value && isPresenter.value) {
    broadcastSnapshot();
  }
  saveAnalysis();
  navState.value = {
    atStart: engine.is_at_start(),
    atLatest: engine.is_at_latest(),
    atMainEnd: engine.is_at_main_end(),
    counter: `${viewIndex}`,
    boardTurnStone: engine.current_turn_stone(),
    boardLastMoveWasPass: engine.last_move_was_pass(),
  };
}
