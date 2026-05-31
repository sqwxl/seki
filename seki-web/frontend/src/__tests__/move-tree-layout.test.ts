import { describe, expect, it } from "vitest";

type LayoutNode = { id: number; col: number; row: number };

function layoutTree(tree: {
  nodes: Array<{ children: number[] }>;
  root_children: number[];
}): LayoutNode[] {
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

  function walkMainline(): number[] {
    const order: number[] = [];
    let col = 0;
    function walk(ids: number[]): void {
      for (const id of ids) {
        layout[id] = { id, col, row: 0 };
        markNode(0, col);
        order.push(id);
        col++;
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
    for (let j = 1; j < kids.length; j++) placeChain(kids[j], pos.row, pos.col);
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
});
