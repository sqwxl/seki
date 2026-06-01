import { describe, expect, it } from "vitest";

type LayoutNode = { id: number; col: number; row: number };

function layoutTree(
  tree: {
    nodes: Array<{ children: number[]; parent?: number | null }>;
    root_children: number[];
  },
  mainLineTipNodeId?: number,
): LayoutNode[] {
  if (tree.nodes.length === 0) return [];

  const layout: LayoutNode[] = new Array(tree.nodes.length);

  const nodeCells = new Set<string>();
  const connectorCells = new Set<string>();
  const dropCells = new Set<string>();

  function key(r: number, c: number): string {
    return `${r},${c}`;
  }
  function isFree(r: number, c: number): boolean {
    const k = key(r, c);
    return !nodeCells.has(k) && !connectorCells.has(k) && !dropCells.has(k);
  }
  function isFreeDrop(r: number, c: number): boolean {
    return !nodeCells.has(key(r, c));
  }
  function isFreeConnector(r: number, c: number): boolean {
    const k = key(r, c);
    return !nodeCells.has(k) && !connectorCells.has(k);
  }
  function markNode(r: number, c: number): void {
    nodeCells.add(key(r, c));
  }
  function markConnector(r: number, c: number): void {
    connectorCells.add(key(r, c));
  }
  function markDrop(r: number, c: number): void {
    dropCells.add(key(r, c));
  }

  function mainlinePathFromTip(): number[] | undefined {
    if (
      mainLineTipNodeId == null ||
      mainLineTipNodeId < 0 ||
      mainLineTipNodeId >= tree.nodes.length
    ) {
      return undefined;
    }

    const path: number[] = [];
    const seen = new Set<number>();
    let id: number | null = mainLineTipNodeId;

    while (id != null) {
      if (id < 0 || id >= tree.nodes.length || seen.has(id)) {
        return undefined;
      }

      path.push(id);
      seen.add(id);
      id = tree.nodes[id].parent ?? null;
    }

    path.reverse();

    return tree.root_children.includes(path[0]) ? path : undefined;
  }

  const mainlinePath = mainlinePathFromTip();
  const mainlineNext = new Map<number, number>();

  if (mainlinePath) {
    for (let i = 0; i < mainlinePath.length - 1; i++) {
      mainlineNext.set(mainlinePath[i], mainlinePath[i + 1]);
    }
  }

  function walkMainline(): number[] {
    const order: number[] = [];
    let col = 0;
    function place(id: number): void {
      layout[id] = { id, col, row: 0 };
      markNode(0, col);
      order.push(id);
      col++;
    }
    if (mainlinePath) {
      for (const id of mainlinePath) place(id);
      return order;
    }
    function walk(ids: number[]): void {
      for (const id of ids) {
        place(id);
        const kids = tree.nodes[id].children;
        if (kids.length > 0) walk([kids[0]]);
      }
    }
    walk(tree.root_children);
    return order;
  }

  const mainlineOrder = walkMainline();

  function chainLen(nodeId: number): number {
    let len = 1;
    let cur = nodeId;
    while (true) {
      const kids = tree.nodes[cur].children;
      if (kids.length === 0) break;
      cur = kids[0];
      len++;
    }
    return len;
  }

  function placeChain(
    nodeId: number,
    parentRow: number,
    parentCol: number,
  ): void {
    const len = chainLen(nodeId);

    let R = parentRow + 1;
    findRow: for (; ; R++) {
      for (let c = parentCol + 1; c <= parentCol + len; c++) {
        if (!isFree(R, c)) continue findRow;
      }
      if (!isFreeConnector(R, parentCol)) continue;
      for (let r = parentRow + 1; r < R; r++) {
        if (!isFreeDrop(r, parentCol)) continue findRow;
      }
      break;
    }

    markConnector(R, parentCol);
    for (let r = parentRow + 1; r < R; r++) markDrop(r, parentCol);

    // place chain nodes
    {
      let col = parentCol + 1;
      let cur = nodeId;
      while (true) {
        layout[cur] = { id: cur, col, row: R };
        markNode(R, col);
        col++;
        const kids = tree.nodes[cur].children;
        if (kids.length === 0) break;
        cur = kids[0];
      }
    }

    // recurse into sub-variants
    {
      let cur = nodeId;
      let col = parentCol + 1;
      while (true) {
        const kids = tree.nodes[cur].children;
        for (let j = 1; j < kids.length; j++) placeChain(kids[j], R, col);
        if (kids.length === 0) break;
        cur = kids[0];
        col++;
      }
    }
  }

  for (let i = mainlineOrder.length - 1; i >= 0; i--) {
    const nodeId = mainlineOrder[i];
    const pos = layout[nodeId];
    const kids = tree.nodes[nodeId].children;
    const mainlineChild = mainlinePath ? mainlineNext.get(nodeId) : kids[0];
    for (const child of kids) {
      if (child !== mainlineChild) placeChain(child, pos.row, pos.col);
    }
  }

  return layout;
}

describe("layoutTree", () => {
  it("variant chain of length 2", () => {
    // 0 → 1 (mainline), variant off 0: 2 → 3
    const tree = {
      nodes: [
        { children: [1, 2] }, // 0
        { children: [] }, // 1
        { children: [3] }, // 2
        { children: [] }, // 3
      ],
      root_children: [0],
    };
    const lay = layoutTree(tree);
    expect(lay[0]).toEqual({ id: 0, col: 0, row: 0 });
    expect(lay[1]).toEqual({ id: 1, col: 1, row: 0 });
    expect(lay[2]).toEqual({ id: 2, col: 1, row: 1 });
    expect(lay[3]).toEqual({ id: 3, col: 2, row: 1 });
  });

  it("places first child of main line tip as a variation", () => {
    const tree = {
      nodes: [
        { children: [1], parent: null },
        { children: [2], parent: 0 },
        { children: [], parent: 1 },
      ],
      root_children: [0],
    };
    const lay = layoutTree(tree, 1);

    expect(lay[0]).toEqual({ id: 0, col: 0, row: 0 });
    expect(lay[1]).toEqual({ id: 1, col: 1, row: 0 });
    expect(lay[2]).toEqual({ id: 2, col: 2, row: 1 });
  });

  it("keeps later live moves on main line after an analysis branch", () => {
    const tree = {
      nodes: [
        { children: [1], parent: null },
        { children: [2], parent: 0 },
        { children: [3, 4], parent: 1 },
        { children: [], parent: 2 },
        { children: [], parent: 2 },
      ],
      root_children: [0],
    };
    const lay = layoutTree(tree, 4);

    expect(lay[0]).toEqual({ id: 0, col: 0, row: 0 });
    expect(lay[1]).toEqual({ id: 1, col: 1, row: 0 });
    expect(lay[2]).toEqual({ id: 2, col: 2, row: 0 });
    expect(lay[3]).toEqual({ id: 3, col: 3, row: 1 });
    expect(lay[4]).toEqual({ id: 4, col: 3, row: 0 });
  });
});
