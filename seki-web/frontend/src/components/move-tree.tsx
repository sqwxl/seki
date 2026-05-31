import { h, type RefObject } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { GameTreeData } from "../game/types";
import { useMediaQuery } from "../utils/media-query";

const BASE_NODE_RADIUS = 12;
const BASE_COL_SPACING = 32;
const BASE_ROW_SPACING = 34;
const BASE_PADDING = 20;

type LayoutNode = {
  id: number;
  col: number;
  row: number;
};

// ---------------------------------------------------------------------------
// Packing tree layout
//
// Mainline (children[0] chain) always stays on row 0.
// Variant chains are packed tightly against the mainline: each chain tries
// rows 1, 2, … and settles on the first row where its connector, drop path,
// and node span don't collide with existing nodes or connector turns.
// │ (drop) cells can stack; └ (connector) and node cells are exclusive.
//
// Processing order: mainline tip → root (reverse).  Deeper variants claim
// lower rows first; shallower ones fill gaps above them.
// ---------------------------------------------------------------------------

function layoutTree(tree: GameTreeData): LayoutNode[] {
  if (tree.nodes.length === 0) {
    return [];
  }

  const layout: LayoutNode[] = new Array(tree.nodes.length);

  // Node cells — exclusive (nothing else can occupy)
  const nodeCells = new Set<string>();
  // Connector-turn cells (└ / ├) — exclusive with nodes and other connectors,
  // but drops (│) can pass through them.
  const connectorCells = new Set<string>();
  // Drop cells (│) — can stack with other drops and with connectors,
  // but blocked by nodes.
  const dropCells = new Set<string>();

  function key(row: number, col: number): string {
    return `${row},${col}`;
  }

  /** True if no node, connector, or drop occupies the cell. */
  function isFree(row: number, col: number): boolean {
    const k = key(row, col);
    return !nodeCells.has(k) && !dropCells.has(k);
  }

  /** True if a drop (│) can pass through — blocked only by nodes. */
  function isFreeDrop(row: number, col: number): boolean {
    return !nodeCells.has(key(row, col));
  }

  /** True if a connector (└) can go here — blocked by nodes and other connectors. */
  function isFreeConnector(row: number, col: number): boolean {
    const k = key(row, col);
    return !nodeCells.has(k) && !connectorCells.has(k);
  }

  function markNode(row: number, col: number): void {
    nodeCells.add(key(row, col));
  }

  function markConnector(row: number, col: number): void {
    connectorCells.add(key(row, col));
  }

  function markDrop(row: number, col: number): void {
    dropCells.add(key(row, col));
  }

  // ---- Mainline ----
  function walkMainline(): number[] {
    const order: number[] = [];
    let col = 0;

    function walk(ids: number[]): void {
      for (const id of ids) {
        layout[id] = { id, col, row: 0 };
        markNode(0, col);
        order.push(id);
        col++;
        const children = tree.nodes[id].children;
        if (children.length > 0) {
          walk([children[0]]);
        }
      }
    }

    walk(tree.root_children);
    return order;
  }

  const mainlineOrder = walkMainline();

  // ---- Chain helpers ----

  /** Return the length of the children[0] chain starting at nodeId (including nodeId). */
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

  /** Place a variant chain (nodeId and its children[0] descendants).
   *  parentRow / parentCol refer to the node this chain branches from. */
  function placeChain(
    nodeId: number,
    parentRow: number,
    parentCol: number,
  ): void {
    const len = chainLen(nodeId);

    // Find the first row that fits
    let bestRow = -1;
    for (let R = parentRow + 1; ; R++) {
      // Node cells: cols parentCol+1 .. parentCol+len on row R
      let ok = true;
      for (let c = parentCol + 1; c <= parentCol + len; c++) {
        if (!isFree(R, c)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      // Connector cell: col parentCol on row R
      if (!isFreeConnector(R, parentCol)) continue;

      // Drop cells: col parentCol on rows parentRow+1 .. R-1
      for (let r = parentRow + 1; r < R; r++) {
        if (!isFreeDrop(r, parentCol)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      bestRow = R;
      break;
    }

    const R = bestRow;

    // Place connector
    markConnector(R, parentCol);

    // Place drop cells
    for (let r = parentRow + 1; r < R; r++) {
      markDrop(r, parentCol);
    }

    // Place chain nodes (children[0] walk)
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

    // Recurse into sub-variants of the chain nodes
    {
      let cur = nodeId;
      let col = parentCol + 1;
      while (true) {
        const kids = tree.nodes[cur].children;
        for (let j = 1; j < kids.length; j++) {
          placeChain(kids[j], R, col);
        }
        if (kids.length === 0) break;
        cur = kids[0];
        col++;
      }
    }
  }

  // ---- Place variant chains in reverse mainline order ----
  for (let i = mainlineOrder.length - 1; i >= 0; i--) {
    const nodeId = mainlineOrder[i];
    const pos = layout[nodeId];
    const children = tree.nodes[nodeId].children;
    for (let j = 1; j < children.length; j++) {
      placeChain(children[j], pos.row, pos.col);
    }
  }

  // Also handle root_children beyond the first (variants branching from root)
  for (let j = 1; j < tree.root_children.length; j++) {
    placeChain(tree.root_children[j], 0, -1);
  }

  return layout;
}

type MoveTreeProps = {
  tree: GameTreeData;
  currentNodeId: number;
  direction?: "horizontal" | "vertical";
  verticalGrowth?: "auto" | "left" | "right";
  onNavigate: (nodeId: number) => void;
};

function useContainerLayout(ref: RefObject<HTMLDivElement>) {
  const [direction, setDirection] = useState<"horizontal" | "vertical">(
    "horizontal",
  );
  const [growth, setGrowth] = useState<"left" | "right">("left");

  useEffect(() => {
    const el = ref.current;

    if (!el) {
      return;
    }

    const target = el;

    function update() {
      const { width, height } = target.getBoundingClientRect();

      if (width <= 0 || height <= 0) {
        return;
      }

      setDirection(height > width ? "vertical" : "horizontal");
      setGrowth(
        target.getBoundingClientRect().left + width / 2 < window.innerWidth / 2
          ? "left"
          : "right",
      );
    }

    update();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(update);
    observer.observe(target);

    return () => observer.disconnect();
  }, [ref]);

  return { direction, growth };
}

export function MoveTree({
  tree,
  currentNodeId,
  direction,
  verticalGrowth = "auto",
  onNavigate,
}: MoveTreeProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const containerLayout = useContainerLayout(scrollRef);
  const layout = useMemo(() => layoutTree(tree), [tree]);
  const resolvedDirection = direction ?? containerLayout.direction;
  const vertical = resolvedDirection === "vertical";
  const resolvedGrowth =
    verticalGrowth === "auto" ? containerLayout.growth : verticalGrowth;
  const scale = isDesktop ? 2 : 1;
  const nodeRadius = BASE_NODE_RADIUS * scale;
  const colSpacing = BASE_COL_SPACING * scale;
  const rowSpacing = BASE_ROW_SPACING * scale;
  const padding = BASE_PADDING * scale;
  const treeEdgePadding = nodeRadius + 4 * scale;

  // Compute active path: ancestors from current node to root
  const activePath = useMemo(() => {
    const path = new Set<number>();

    if (currentNodeId >= 0 && currentNodeId < tree.nodes.length) {
      let id: number | null = currentNodeId;

      while (id != null) {
        path.add(id);
        id = tree.nodes[id].parent;
      }
    }

    return path;
  }, [currentNodeId, tree]);

  const maxCol = layout.reduce((m, n) => (n ? Math.max(m, n.col) : m), 0);
  const maxRow = layout.reduce((m, n) => (n ? Math.max(m, n.row) : m), 0);

  const svgWidth = vertical
    ? maxRow * rowSpacing + treeEdgePadding * 2
    : maxCol * colSpacing + treeEdgePadding * 2;
  const svgHeight = vertical
    ? maxCol * colSpacing + treeEdgePadding * 2
    : maxRow * rowSpacing + treeEdgePadding * 2;

  function cx(col: number, row: number): number {
    if (!vertical) {
      return treeEdgePadding + col * colSpacing;
    }

    return resolvedGrowth === "left"
      ? svgWidth - treeEdgePadding - row * rowSpacing
      : treeEdgePadding + row * rowSpacing;
  }
  function cy(col: number, row: number): number {
    return vertical
      ? treeEdgePadding + col * colSpacing
      : treeEdgePadding + row * rowSpacing;
  }

  // Auto-scroll to keep current node visible
  useEffect(() => {
    const el = scrollRef.current;

    if (!el) {
      return;
    }

    const scrollEl = el;

    function scrollToCurrent(): void {
      let x: number;
      let y: number;

      if (currentNodeId === -1) {
        x = cx(0, 0);
        y = cy(0, 0);
      } else {
        const cur = layout.find((n) => n && n.id === currentNodeId);

        if (!cur) {
          return;
        }

        x = cx(cur.col, cur.row);
        y = cy(cur.col, cur.row);
      }

      const w = scrollEl.clientWidth;
      const h = scrollEl.clientHeight;

      if (w === 0 || h === 0) {
        return;
      }

      const pad = vertical ? treeEdgePadding : padding;
      const sl = scrollEl.scrollLeft;
      const st = scrollEl.scrollTop;

      if (x - pad < sl) {
        scrollEl.scrollLeft = Math.max(0, x - pad);
      } else if (x + pad > sl + w) {
        scrollEl.scrollLeft = x + pad - w;
      }

      if (y - pad < st) {
        scrollEl.scrollTop = Math.max(0, y - pad);
      } else if (y + pad > st + h) {
        scrollEl.scrollTop = y + pad - h;
      }
    }

    let frame = requestAnimationFrame(() => {
      scrollToCurrent();
      frame = requestAnimationFrame(scrollToCurrent);
    });

    if (typeof ResizeObserver === "undefined") {
      return () => cancelAnimationFrame(frame);
    }

    const observer = new ResizeObserver(scrollToCurrent);
    observer.observe(scrollEl);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [
    currentNodeId,
    tree,
    layout,
    resolvedDirection,
    resolvedGrowth,
    maxRow,
    maxCol,
    isDesktop,
  ]);

  if (layout.length === 0) {
    return null;
  }

  // Build edges
  const inactiveEdges: h.JSX.Element[] = [];
  const activeEdges: h.JSX.Element[] = [];

  for (const node of layout) {
    if (!node) {
      continue;
    }

    const treeNode = tree.nodes[node.id];

    if (treeNode.parent != null) {
      const parentLayout = layout[treeNode.parent];

      if (parentLayout) {
        const x1 = cx(parentLayout.col, parentLayout.row);
        const y1 = cy(parentLayout.col, parentLayout.row);
        const x2 = cx(node.col, node.row);
        const y2 = cy(node.col, node.row);

        // Same-branch check: horizontal checks y, vertical checks x
        const straight = vertical ? x1 === x2 : y1 === y2;

        const onActivePath =
          activePath.has(treeNode.parent) && activePath.has(node.id);
        const edgeStyle = {
          stroke: onActivePath ? "var(--tree-stroke)" : "var(--tree-edge)",
          strokeWidth: onActivePath ? 2.5 * scale : 2,
          pointerEvents: "none",
        };
        const edges = onActivePath ? activeEdges : inactiveEdges;

        if (straight) {
          edges.push(
            <line
              key={`e-${treeNode.parent}-${node.id}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              style={edgeStyle}
            />,
          );
        } else {
          // diagonal connector
          const s = resolvedGrowth === "left" ? 1 : -1;
          const ortho = vertical
            ? `H ${x2 + s * colSpacing}`
            : `V ${y2 - colSpacing}`;
          const c = colSpacing * 0.5; // curvature
          const C = vertical
            ? `C ${x2 + s * c},${y1} ${x2},${y2 - c} ${x2},${y2}`
            : `C ${x1},${y2 - colSpacing + c} ${x2 - c},${y2} ${x2},${y2}`;
          edges.push(
            <path
              key={`e-${treeNode.parent}-${node.id}`}
              d={`M ${x1}, ${y1}
                  ${ortho}
                  ${C}
                  `}
              fill="none"
              style={edgeStyle}
            />,
          );
        }
      }
    }
  }

  // Build nodes
  const rootNodes: h.JSX.Element[] = [];
  const nodes: h.JSX.Element[] = [];

  for (const node of layout) {
    if (!node) {
      continue;
    }

    const treeNode = tree.nodes[node.id];
    const x = cx(node.col, node.row);
    const y = cy(node.col, node.row);
    const isCurrent = node.id === currentNodeId;
    const stone = treeNode.turn.stone;
    const isPass = treeNode.turn.kind === "pass";
    const isRoot = stone === 0;
    const onPath = isRoot || activePath.has(node.id);
    const radius = nodeRadius;
    const strokeColor = onPath
      ? "var(--tree-stroke)"
      : "var(--tree-stroke-muted)";
    const strokeWidth = onPath ? 2 : 1;
    const blackFill = onPath ? "var(--tree-black)" : "var(--tree-black-muted)";
    const whiteFill = onPath ? "var(--tree-white)" : "var(--tree-white-muted)";
    const stoneFill = stone === 1 ? blackFill : whiteFill;
    const textFill =
      stone === 1 ? "var(--tree-text-on-black)" : "var(--tree-text-on-white)";

    const renderedNode = (
      <g
        key={`n-${node.id}`}
        style={{ cursor: "pointer" }}
        onClick={() => onNavigate(node.id)}
      >
        {isRoot ? (
          <>
            <circle cx={x} cy={y} r={radius} style={{ fill: "transparent" }} />
            {isCurrent && (
              <circle
                cx={x}
                cy={y}
                r={radius + 3 * scale}
                style={{
                  fill: "none",
                  stroke: "var(--blue)",
                  strokeWidth: 1.5 * scale,
                }}
              />
            )}
            <circle
              cx={x}
              cy={y}
              r={4 * scale}
              style={{
                fill: "var(--tree-stroke)",
              }}
            />
          </>
        ) : isPass ? (
          <rect
            x={x - radius}
            y={y - radius}
            width={radius * 2}
            height={radius * 2}
            rx={2 * scale}
            style={{
              fill: stoneFill,
              stroke: strokeColor,
              strokeWidth,
            }}
          />
        ) : (
          <circle
            cx={x}
            cy={y}
            r={radius}
            style={{
              fill: stoneFill,
              stroke: strokeColor,
              strokeWidth,
            }}
          />
        )}
        {isCurrent &&
          !isRoot &&
          (isPass ? (
            <rect
              x={x - radius - 3 * scale}
              y={y - radius - 3 * scale}
              width={(radius + 3 * scale) * 2}
              height={(radius + 3 * scale) * 2}
              rx={3 * scale}
              style={{
                fill: "none",
                stroke: "var(--blue)",
                strokeWidth: 1.5 * scale,
              }}
            />
          ) : (
            <circle
              cx={x}
              cy={y}
              r={radius + 3 * scale}
              style={{
                fill: "none",
                stroke: "var(--blue)",
                strokeWidth: 1.5 * scale,
              }}
            />
          ))}
        {!isRoot && (
          <text
            x={x}
            y={y}
            text-anchor="middle"
            dominant-baseline="central"
            style={{
              fontSize: 10 * scale,
              fill: textFill,
            }}
          >
            {node.col}
          </text>
        )}
      </g>
    );

    if (isRoot) {
      rootNodes.push(renderedNode);
    } else {
      nodes.push(renderedNode);
    }
  }

  return (
    <div
      ref={scrollRef}
      style={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        scrollBehavior: "smooth",
      }}
    >
      <svg
        style={
          vertical
            ? {
                display: "block",
                marginLeft: resolvedGrowth === "left" ? "auto" : undefined,
              }
            : undefined
        }
        width={svgWidth}
        height={svgHeight}
      >
        {inactiveEdges}
        {activeEdges}
        {rootNodes}
        {nodes}
      </svg>
    </div>
  );
}
