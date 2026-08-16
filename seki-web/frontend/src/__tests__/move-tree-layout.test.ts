import { describe, expect, it } from "vitest";
import { placeTree, type TreeStructure } from "../game/move-tree-layout";

/** Build a TreeStructure from a children adjacency list, filling in parents. */
function tree(children: number[][]): TreeStructure {
  const nodes = children.map((kids) => ({
    parent: null as number | null,
    children: kids,
  }));

  for (let id = 0; id < nodes.length; id++) {
    for (const kid of nodes[id].children) {
      nodes[kid].parent = id;
    }
  }

  return { nodes, root_children: [0] };
}

describe("placeTree", () => {
  it("variant net of length 2", () => {
    // 0 → 1 (mainline), variant off 0: 2 → 3
    const t = tree([[1, 2], [], [3], []]);
    const placement = placeTree(t);

    expect(placement[0]).toEqual({ id: 0, column: 0, track: 0 });
    expect(placement[1]).toEqual({ id: 1, column: 1, track: 0 });
    expect(placement[2]).toEqual({ id: 2, column: 1, track: 1 });
    expect(placement[3]).toEqual({ id: 3, column: 2, track: 1 });
  });

  it("places first child of main line tip as a variation", () => {
    const t = tree([[1], [2], []]);
    const placement = placeTree(t, 1);

    expect(placement[0]).toEqual({ id: 0, column: 0, track: 0 });
    expect(placement[1]).toEqual({ id: 1, column: 1, track: 0 });
    expect(placement[2]).toEqual({ id: 2, column: 2, track: 1 });
  });

  it("keeps later live moves on main line after an analysis branch", () => {
    const t = tree([[1], [2], [3, 4], [], []]);
    const placement = placeTree(t, 4);

    expect(placement[0]).toEqual({ id: 0, column: 0, track: 0 });
    expect(placement[1]).toEqual({ id: 1, column: 1, track: 0 });
    expect(placement[2]).toEqual({ id: 2, column: 2, track: 0 });
    expect(placement[3]).toEqual({ id: 3, column: 3, track: 1 });
    expect(placement[4]).toEqual({ id: 4, column: 3, track: 0 });
  });
});
