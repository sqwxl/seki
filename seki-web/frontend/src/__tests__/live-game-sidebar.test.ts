import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../goban/render-board", () => ({
  invalidateTreeCache: vi.fn(),
}));

import { invalidateTreeCache } from "../goban/render-board";
import {
  loadSavedAnalysisTree,
  readSavedAnalysis,
  saveAnalysis,
} from "../layouts/live-game/sidebar";
import { gameAnalysisKey, storage } from "../utils/storage";

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("live game analysis storage", () => {
  it("hydrates the saved tree into the board on page load", () => {
    const analysisKey = gameAnalysisKey(42);
    const savedTree = {
      nodes: [
        {
          turn: { kind: "play", stone: 1, pos: [3, 3] },
          parent: null,
          children: [1],
        },
        {
          turn: { kind: "play", stone: -1, pos: [4, 4] },
          parent: 0,
          children: [],
        },
      ],
      root_children: [0],
    };

    storage.setJson(analysisKey, {
      tree: JSON.stringify(savedTree),
      nodeId: 1,
    });

    const replaceTree = vi.fn();
    const mergeBaseMoves = vi.fn();
    const board = {
      engine: {
        replace_tree: replaceTree,
        merge_base_moves: mergeBaseMoves,
      },
    };

    const saved = loadSavedAnalysisTree(board as never, analysisKey, []);

    expect(saved).toEqual({
      tree: JSON.stringify(savedTree),
      nodeId: 1,
    });
    expect(invalidateTreeCache).toHaveBeenCalled();
    expect(replaceTree).toHaveBeenCalledWith(JSON.stringify(savedTree));
    expect(mergeBaseMoves).not.toHaveBeenCalled();
    expect(readSavedAnalysis(analysisKey)).toEqual(saved);
  });

  it("saves analysis trees without restoring analysis mode", () => {
    const analysisKey = gameAnalysisKey(42);
    const board = {
      engine: {
        tree_json: () => "tree",
        current_node_id: () => 7,
      },
    };

    saveAnalysis(board as never, true, analysisKey);

    expect(readSavedAnalysis(analysisKey)).toEqual({
      tree: "tree",
      nodeId: 7,
    });
  });
});
