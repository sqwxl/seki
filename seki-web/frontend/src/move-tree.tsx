import { h } from "preact";
import { useEffect } from "preact/hooks";
import type { GameTreeData } from "./goban/types";

const NODE_RADIUS = 12;
const COL_SPACING = 32;
const ROW_SPACING = 34;
const PADDING = 20;

type LayoutNode = {
  id: number;
  col: number;
  row: number;
};

function layoutTree(tree: GameTreeData): LayoutNode[] {
  if (tree.nodes.length === 0) {
    return [];
  }

  const layout: LayoutNode[] = new Array(tree.nodes.length);
  let nextRow = 0;

  function walk(nodeId: number, col: number, row: number): void {
    layout[nodeId] = { id: nodeId, col, row };

    const children = tree.nodes[nodeId].children;
    for (let i = 0; i < children.length; i++) {
      if (i === 0) {
        // First child stays on the same row
        walk(children[i], col + 1, row);
      } else {
        // Additional children get new rows
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
  scrollContainer: HTMLElement;
  onNavigate: (nodeId: number) => void;
};

export function MoveTree({
  tree,
  currentNodeId,
  scrollContainer,
  onNavigate,
}: MoveTreeProps) {
  const layout = layoutTree(tree);

  if (layout.length === 0) {
    return null;
  }

  const maxCol = layout.reduce((m, n) => Math.max(m, n.col), 0);
  const maxRow = layout.reduce((m, n) => Math.max(m, n.row), 0);

  const rootX = PADDING;
  const svgWidth = (maxCol + 1) * COL_SPACING + PADDING * 2 + COL_SPACING;
  const svgHeight = (maxRow + 1) * ROW_SPACING + PADDING * 2;

  function cx(col: number): number {
    return PADDING + (col + 1) * COL_SPACING;
  }
  function cy(row: number): number {
    return PADDING + row * ROW_SPACING;
  }

  // Auto-scroll to keep current node visible
  useEffect(() => {
    let x: number;
    let y: number;
    if (currentNodeId === -1) {
      x = rootX;
      y = cy(0);
    } else {
      const cur = layout.find((n) => n.id === currentNodeId);
      if (!cur) {
        return;
      }
      x = cx(cur.col);
      y = cy(cur.row);
    }
    const pad = PADDING;
    const sl = scrollContainer.scrollLeft;
    const st = scrollContainer.scrollTop;
    const w = scrollContainer.clientWidth;
    const h = scrollContainer.clientHeight;

    if (x - pad < sl) {
      scrollContainer.scrollLeft = Math.max(0, x - pad);
    } else if (x + pad > sl + w) {
      scrollContainer.scrollLeft = x + pad - w;
    }
    if (y - pad < st) {
      scrollContainer.scrollTop = Math.max(0, y - pad);
    } else if (y + pad > st + h) {
      scrollContainer.scrollTop = y + pad - h;
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
        const x1 = cx(parentLayout.col);
        const y1 = cy(parentLayout.row);
        const x2 = cx(node.col);
        const y2 = cy(node.row);

        if (y1 === y2) {
          // Straight horizontal line
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
          // L-shaped: go down from parent, then across to child
          edges.push(
            <polyline
              key={`e-${treeNode.parent}-${node.id}`}
              points={`${x1},${y1} ${x1},${y2} ${x2},${y2}`}
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
    const x = cx(node.col);
    const y = cy(node.row);
    const isCurrent = node.id === currentNodeId;
    const stone = treeNode.turn.stone;
    const isPass = treeNode.turn.kind === "pass";

    const isRoot = stone === 0;
    const fill = isRoot
      ? "#222"
      : isPass
        ? "#f5f5f5"
        : stone === 1
          ? "#222"
          : "#fff";
    const radius = isCurrent ? NODE_RADIUS * 1.4 : NODE_RADIUS;
    const strokeColor = "#555";
    const strokeWidth = 1.2;

    nodes.push(
      <g
        key={`n-${node.id}`}
        style={{ cursor: "pointer" }}
        onClick={() => onNavigate(node.id)}
      >
        {isRoot ? (
          <>
            <circle cx={x} cy={y} r={radius} fill="transparent" stroke={isCurrent ? "#555" : "none"} stroke-width={1} stroke-dasharray="3 3" />
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
              stroke={strokeColor}
              stroke-width={2}
            />
          </>
        ) : (
          <circle
            cx={x}
            cy={y}
            r={radius}
            fill={fill}
            stroke={strokeColor}
            stroke-width={strokeWidth}
          />
        )}
        {!isRoot && isPass && (
          <text
            x={x}
            y={y}
            text-anchor="middle"
            dominant-baseline="central"
            font-size={10}
            fill="#888"
          >
            ⋯
          </text>
        )}
        {!isRoot && !isPass && (
          <text
            x={x}
            y={y}
            text-anchor="middle"
            dominant-baseline="central"
            font-size={10}
            fill={stone === 1 ? "#fff" : "#222"}
          >
            {node.col}
          </text>
        )}
      </g>,
    );
  }

  return (
    <svg width={svgWidth} height={svgHeight}>
      {edges}
      {nodes}
    </svg>
  );
}
