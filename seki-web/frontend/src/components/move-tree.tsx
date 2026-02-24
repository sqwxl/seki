import { h } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { GameTreeData } from "../game/types";

const NODE_RADIUS = 12;
const COL_SPACING = 32;
const ROW_SPACING = 34;
const PADDING = 20;

type LayoutNode = {
  id: number;
  col: number;
  row: number;
};

function layoutTree(
  tree: GameTreeData,
  branchAfterNodeId?: number,
): LayoutNode[] {
  if (tree.nodes.length === 0) {
    return [];
  }

  const layout: LayoutNode[] = new Array(tree.nodes.length);
  let nextRow = 0;

  function walk(nodeId: number, col: number, row: number): void {
    layout[nodeId] = { id: nodeId, col, row };

    const children = tree.nodes[nodeId].children;
    const allBranch = nodeId === branchAfterNodeId;
    for (let i = 0; i < children.length; i++) {
      if (i === 0 && !allBranch) {
        // First child stays on the same row
        walk(children[i], col + 1, row);
      } else {
        // Additional children (or all children when branching) get new rows
        nextRow++;
        walk(children[i], col + 1, nextRow);
      }
    }
  }

  for (let i = 0; i < tree.root_children.length; i++) {
    const rootId = tree.root_children[i];
    if (i === 0) {
      walk(rootId, 0, nextRow);
    } else {
      nextRow++;
      walk(rootId, 0, nextRow);
    }
  }

  return layout;
}

type MoveTreeProps = {
  tree: GameTreeData;
  currentNodeId: number;
  finalizedNodeIds?: Set<number>;
  branchAfterNodeId?: number;
  direction?: "horizontal" | "vertical";
  onNavigate: (nodeId: number) => void;
  onReset?: () => void;
};

export function MoveTree({
  tree,
  currentNodeId,
  finalizedNodeIds,
  branchAfterNodeId,
  direction = "horizontal",
  onNavigate,
  onReset,
}: MoveTreeProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const layout = layoutTree(tree, branchAfterNodeId);
  const vertical = direction === "vertical";

  if (layout.length === 0) {
    return null;
  }

  // Compute active path: ancestors from current node to root
  const activePath = new Set<number>();
  if (currentNodeId >= 0 && currentNodeId < tree.nodes.length) {
    let id: number | null = currentNodeId;
    while (id != null) {
      activePath.add(id);
      id = tree.nodes[id].parent;
    }
  }

  const maxCol = layout.reduce((m, n) => Math.max(m, n.col), 0);
  const maxRow = layout.reduce((m, n) => Math.max(m, n.row), 0);

  const svgWidth = vertical
    ? (maxRow + 1) * ROW_SPACING + PADDING * 2
    : (maxCol + 1) * COL_SPACING + PADDING * 2 + COL_SPACING;
  const svgHeight = vertical
    ? (maxCol + 1) * COL_SPACING + PADDING * 2 + COL_SPACING
    : (maxRow + 1) * ROW_SPACING + PADDING * 2;

  function cx(col: number, row: number): number {
    return vertical
      ? PADDING + (maxRow - row) * ROW_SPACING
      : PADDING + (col + 1) * COL_SPACING;
  }
  function cy(col: number, row: number): number {
    return vertical
      ? PADDING + (col + 1) * COL_SPACING
      : PADDING + row * ROW_SPACING;
  }

  // Auto-scroll to keep current node visible
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    let x: number;
    let y: number;
    if (currentNodeId === -1) {
      x = cx(0, 0);
      y = cy(0, 0);
    } else {
      const cur = layout.find((n) => n.id === currentNodeId);
      if (!cur) {
        return;
      }
      x = cx(cur.col, cur.row);
      y = cy(cur.col, cur.row);
    }
    const pad = PADDING;
    const sl = el.scrollLeft;
    const st = el.scrollTop;
    const w = el.clientWidth;
    const h = el.clientHeight;

    if (x - pad < sl) {
      el.scrollLeft = Math.max(0, x - pad);
    } else if (x + pad > sl + w) {
      el.scrollLeft = x + pad - w;
    }
    if (y - pad < st) {
      el.scrollTop = Math.max(0, y - pad);
    } else if (y + pad > st + h) {
      el.scrollTop = y + pad - h;
    }
  }, [currentNodeId, tree]);

  // Build edges
  const edges: h.JSX.Element[] = [];
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

        if (straight) {
          edges.push(
            <line
              key={`e-${treeNode.parent}-${node.id}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#888"
              stroke-width={1.5}
            />,
          );
        } else {
          // L-shaped: horizontal = down then across, vertical = across then down
          const mid = vertical ? `${x2},${y1}` : `${x1},${y2}`;
          edges.push(
            <polyline
              key={`e-${treeNode.parent}-${node.id}`}
              points={`${x1},${y1} ${mid} ${x2},${y2}`}
              fill="none"
              stroke="#888"
              stroke-width={1.5}
            />,
          );
        }
      }
    }
  }

  // Build nodes
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
    const isFinalized = finalizedNodeIds?.has(node.id) ?? false;

    const isRoot = stone === 0;
    const onPath = isRoot || activePath.has(node.id);
    const radius = NODE_RADIUS;
    // Active: heavier stroke for path emphasis; muted: lighter stroke
    const strokeColor = onPath ? "#444" : "#aaa";
    const strokeWidth = onPath ? 2 : 1;
    // Muted fills: #666/#ccc give 3.6:1 contrast between muted black/white
    const blackFill = onPath ? "#222" : "#666";
    const whiteFill = onPath ? "#fff" : "#ddd";
    const stoneFill = stone === 1 ? blackFill : whiteFill;
    const textFill = stone === 1 ? "#fff" : "#222";

    nodes.push(
      <g
        key={`n-${node.id}`}
        style={{ cursor: "pointer" }}
        onClick={() => onNavigate(node.id)}
      >
        {isFinalized ? (
          <>
            {/* Split circle: left=black, right=white */}
            <path
              d={`M ${x} ${y - radius} A ${radius} ${radius} 0 0 0 ${x} ${y + radius} Z`}
              fill={blackFill}
              stroke={strokeColor}
              stroke-width={strokeWidth}
            />
            <path
              d={`M ${x} ${y - radius} A ${radius} ${radius} 0 0 1 ${x} ${y + radius} Z`}
              fill={whiteFill}
              stroke={strokeColor}
              stroke-width={strokeWidth}
            />
          </>
        ) : isRoot ? (
          <>
            <circle
              cx={x}
              cy={y}
              r={radius}
              fill="transparent"
              stroke={isCurrent ? "#555" : "none"}
              stroke-width={1}
              stroke-dasharray="3 3"
            />
            <line
              x1={x - radius}
              y1={y}
              x2={x + radius}
              y2={y}
              stroke="#888"
              stroke-width={1.5}
            />
            <line
              x1={x}
              y1={y - radius}
              x2={x}
              y2={y + radius}
              stroke="#555"
              stroke-width={2}
            />
          </>
        ) : isPass ? (
          <rect
            x={x - radius}
            y={y - radius}
            width={radius * 2}
            height={radius * 2}
            rx={2}
            fill={stoneFill}
            stroke={strokeColor}
            stroke-width={strokeWidth}
          />
        ) : (
          <circle
            cx={x}
            cy={y}
            r={radius}
            fill={stoneFill}
            stroke={strokeColor}
            stroke-width={strokeWidth}
          />
        )}
        {!isFinalized && !isRoot && (
          <text
            x={x}
            y={y}
            text-anchor="middle"
            dominant-baseline="central"
            font-size={10}
            fill={textFill}
          >
            {node.col}
          </text>
        )}
      </g>,
    );
  }

  const resetBtn = onReset && (
    <button
      onClick={onReset}
      style={{
        alignSelf: "flex-start",
        fontSize: "0.75rem",
        padding: "2px 8px",
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      Reset
    </button>
  );

  return (
    <>
      {vertical && resetBtn}
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
            vertical ? { display: "block", marginLeft: "auto" } : undefined
          }
          width={svgWidth}
          height={svgHeight}
        >
          {edges}
          {nodes}
        </svg>
      </div>
      {!vertical && resetBtn}
    </>
  );
}
