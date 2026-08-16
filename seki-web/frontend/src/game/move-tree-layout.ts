// ---------------------------------------------------------------------------
// Move-tree positioning: a channel router.
//
// The game tree is routed onto a grid. The mainline (children[0] chain) sits
// on track 0; every variant net hangs below its parent. A net occupies three
// cell kinds:
//   - node cells — blocked by nodes and trunks; a dogleg may tuck behind one;
//   - dogleg cells (└) — the elbow where a net turns down; exclusive with
//     nodes and other doglegs, but trunks may pass through;
//   - trunk cells (│) — the vertical run of a dogleg; may stack with trunks
//     and doglegs, but blocked by nodes.
//
// Nets are routed in reverse mainline order (tip → root), so deeper nets
// claim tracks closer to the mainline first. Within a net, nodes are placed
// one at a time, each on the lowest track ≥ the track of the node before it
// (the vertical constraint): a node that drops to clear a collision stays
// down for the rest of the net (a monotone dogleg), and non-overlapping nets
// may share a track.
// ---------------------------------------------------------------------------

export type PlacedNode = {
  id: number;
  column: number;
  track: number;
};

export type TreeStructure = {
  nodes: Array<{ parent?: number | null; children: number[] }>;
  root_children: number[];
};

export function placeTree(
  tree: TreeStructure,
  mainlineTipNodeId?: number,
): PlacedNode[] {
  if (tree.nodes.length === 0) {
    return [];
  }

  const placement: PlacedNode[] = new Array(tree.nodes.length);

  // Node cells — blocked by other nodes and trunks; a dogleg may tuck behind.
  const nodeCells = new Set<string>();
  const nodeTracksByColumn = new Map<number, Set<number>>();
  // Dogleg cells (└) — exclusive with nodes and other doglegs,
  // but trunks (│) can pass through them.
  const doglegCells = new Set<string>();
  // Trunk cells (│) — can stack with other trunks and doglegs,
  // but blocked by nodes.
  const trunkCells = new Set<string>();

  function cellKey(track: number, column: number): string {
    return `${track},${column}`;
  }

  /** True if a node may occupy this cell (no node or trunk here). */
  function isNodeCellFree(track: number, column: number): boolean {
    const k = cellKey(track, column);
    return !nodeCells.has(k) && !trunkCells.has(k);
  }

  /** True if a dogleg (└) may occupy this cell (no node or dogleg here). */
  function isDoglegCellFree(track: number, column: number): boolean {
    const k = cellKey(track, column);
    return !nodeCells.has(k) && !doglegCells.has(k);
  }

  function markNode(track: number, column: number): void {
    nodeCells.add(cellKey(track, column));
    let tracks = nodeTracksByColumn.get(column);

    if (!tracks) {
      tracks = new Set();
      nodeTracksByColumn.set(column, tracks);
    }

    tracks.add(track);
  }

  function markDogleg(track: number, column: number): void {
    doglegCells.add(cellKey(track, column));
  }

  function markTrunk(track: number, column: number): void {
    trunkCells.add(cellKey(track, column));
  }

  function isTrunkPathFree(
    fromTrack: number,
    toTrack: number,
    column: number,
  ): boolean {
    const tracks = nodeTracksByColumn.get(column);

    if (!tracks) {
      return true;
    }

    for (const track of tracks) {
      if (track >= fromTrack && track <= toTrack) {
        return false;
      }
    }

    return true;
  }

  function mainlinePathFromTip(): number[] | undefined {
    if (
      mainlineTipNodeId == null ||
      mainlineTipNodeId < 0 ||
      mainlineTipNodeId >= tree.nodes.length
    ) {
      return undefined;
    }

    const path: number[] = [];
    const seen = new Set<number>();
    let id: number | null = mainlineTipNodeId;

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

  // ---- Mainline ----
  const mainlinePath = mainlinePathFromTip();
  const mainlineNext = new Map<number, number>();

  if (mainlinePath) {
    for (let i = 0; i < mainlinePath.length - 1; i++) {
      mainlineNext.set(mainlinePath[i], mainlinePath[i + 1]);
    }
  }

  function placeMainline(): number[] {
    const order: number[] = [];
    let column = 0;

    function place(id: number): void {
      placement[id] = { id, column, track: 0 };
      markNode(0, column);
      order.push(id);
      column++;
    }

    if (mainlinePath) {
      for (const id of mainlinePath) {
        place(id);
      }

      return order;
    }

    function walk(ids: number[]): void {
      for (const id of ids) {
        place(id);
        const children = tree.nodes[id].children;
        if (children.length > 0) {
          walk([children[0]]);
        }
      }
    }

    walk(tree.root_children);
    return order;
  }

  const mainlineOrder = placeMainline();

  // ---- Net helpers ----

  /** First track ≥ floor where a node fits; fallback to maxSearchTrack. */
  function findNodeTrack(
    floor: number,
    column: number,
    parentTrack: number,
    parentColumn: number,
  ): number {
    const maxSearchTrack = tree.nodes.length + 1;

    for (let t = floor; t <= maxSearchTrack; t++) {
      if (!isNodeCellFree(t, column)) continue;

      if (t > parentTrack) {
        if (!isDoglegCellFree(t, parentColumn)) continue;
        if (!isTrunkPathFree(parentTrack + 1, t - 1, parentColumn)) continue;
      }

      return t;
    }

    return maxSearchTrack;
  }

  /** Route a variant net (nodeId and its children[0] descendants).
   *  parentTrack / parentColumn refer to the node this net branches from.
   *
   *  Nodes are placed one at a time, each on the lowest track ≥ the track of
   *  the node before it (the vertical constraint). A node that drops to clear
   *  a collision stays down for the rest of the net (a monotone dogleg). */
  function placeNet(
    nodeId: number,
    parentTrack: number,
    parentColumn: number,
  ): void {
    // Phase 1: place the net nodes (children[0] walk), monotone tracks.
    const chainNodes: number[] = [];
    {
      let cur = nodeId;
      let column = parentColumn + 1;
      let prevTrack = parentTrack;
      let prevColumn = parentColumn;
      let floor = parentTrack + 1; // the first node drops below its parent
      const seen = new Set<number>();

      while (true) {
        if (seen.has(cur)) break;
        seen.add(cur);

        const track = findNodeTrack(floor, column, prevTrack, prevColumn);

        placement[cur] = { id: cur, column, track };
        markNode(track, column);

        if (track > prevTrack) {
          markDogleg(track, prevColumn);
          for (let r = prevTrack + 1; r < track; r++) {
            markTrunk(r, prevColumn);
          }
        }

        chainNodes.push(cur);

        const kids = tree.nodes[cur].children;
        if (kids.length === 0) break;

        prevTrack = track;
        prevColumn = column;
        floor = track; // subsequent nodes may stay on this track
        column++;
        cur = kids[0];
      }
    }

    // Phase 2: route sub-nets, tip → root of the net (mirrors the mainline
    // loop), after the whole net is placed. Deepest-first lets a deep sub-net
    // claim the closer track; a shallower sibling then tucks behind its
    // dogleg instead of blocking its drop path.
    for (let i = chainNodes.length - 1; i >= 0; i--) {
      const cur = chainNodes[i];
      const pos = placement[cur];
      const kids = tree.nodes[cur].children;
      for (let j = 1; j < kids.length; j++) {
        placeNet(kids[j], pos.track, pos.column);
      }
    }
  }

  // ---- Route variant nets in reverse mainline order ----
  for (let i = mainlineOrder.length - 1; i >= 0; i--) {
    const nodeId = mainlineOrder[i];
    const pos = placement[nodeId];
    const children = tree.nodes[nodeId].children;
    const mainlineChild = mainlinePath ? mainlineNext.get(nodeId) : children[0];

    for (const child of children) {
      if (child !== mainlineChild) {
        placeNet(child, pos.track, pos.column);
      }
    }
  }

  // Also route root_children beyond the mainline root
  const mainlineRoot = mainlineOrder[0];
  for (const rootChild of tree.root_children) {
    if (rootChild !== mainlineRoot) {
      placeNet(rootChild, 0, -1);
    }
  }

  return placement;
}
