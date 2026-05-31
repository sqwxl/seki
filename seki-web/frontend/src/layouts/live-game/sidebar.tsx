import type { Board } from "../../goban/create-board";
import { invalidateTreeCache } from "../../goban/render-board";
import { storage } from "../../utils/storage";

type SavedAnalysis = {
  tree: string;
  nodeId: number;
  active?: boolean;
};

export function readSavedAnalysis(
  analysisKey: string,
): SavedAnalysis | undefined {
  return storage.getJson<SavedAnalysis>(analysisKey);
}

export function saveAnalysis(
  board: Board | undefined,
  analysisMode: boolean,
  analysisKey: string,
  active?: boolean,
) {
  if (!board) {
    return;
  }

  const nextActive = active ?? analysisMode;

  if (analysisMode || nextActive) {
    storage.setJson(analysisKey, {
      tree: board.engine.tree_json(),
      nodeId: board.engine.current_node_id(),
      active: nextActive,
    });

    return;
  }

  const saved = readSavedAnalysis(analysisKey);

  if (saved) {
    storage.setJson(analysisKey, { ...saved, active: nextActive });
  }
}

export function loadSavedAnalysisTree(
  board: Board | undefined,
  analysisKey: string,
  movesValue: unknown[],
): SavedAnalysis | undefined {
  if (!board) {
    return undefined;
  }

  const saved = readSavedAnalysis(analysisKey);

  if (!saved?.tree) {
    return saved;
  }

  invalidateTreeCache();
  board.engine.replace_tree(saved.tree);

  return saved;
}

export function restoreAnalysisPosition(
  board: Board | undefined,
  saved?: SavedAnalysis,
): void {
  if (!board || !saved) {
    return;
  }

  if (saved.nodeId >= 0) {
    board.engine.navigate_to(saved.nodeId);
  } else {
    board.engine.to_start();
  }
}
