import { h } from "preact";
import { useRef, useEffect } from "preact/hooks";
import type { GameTreeData } from "./goban/types";

const NODE_RADIUS = 9;
const COL_SPACING = 26;
const ROW_SPACING = 26;
const PADDING = 14;

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
  onNavigate: (nodeId: number) => void;
};

export function MoveTree({ tree, currentNodeId, onNavigate }: MoveTreeProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const layout = layoutTree(tree);

  if (layout.length === 0) {
    return <div class="move-tree" />;
  }

  const maxCol = layout.reduce((m, n) => Math.max(m, n.col), 0);
  const maxRow = layout.reduce((m, n) => Math.max(m, n.row), 0);

  const svgWidth = (maxCol + 1) * COL_SPACING + PADDING * 2;
  const svgHeight = (maxRow + 1) * ROW_SPACING + PADDING * 2;

  function cx(col: number): number {
    return PADDING + col * COL_SPACING;
  }
  function cy(row: number): number {
    return PADDING + row * ROW_SPACING;
  }

  // Auto-scroll to current node
  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    const currentLayout = layout.find((n) => n.id === currentNodeId);
    if (!currentLayout) {
      return;
    }
    const x = cx(currentLayout.col);
    const container = containerRef.current;
    const scrollTarget = x - container.clientWidth / 2;
    container.scrollLeft = Math.max(0, scrollTarget);
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

    const fill = isPass ? "#f5f5f5" : stone === 1 ? "#222" : "#fff";
    const strokeColor = isCurrent ? "#2196f3" : "#555";
    const strokeWidth = isCurrent ? 2.5 : 1.2;

    nodes.push(
      <g
        key={`n-${node.id}`}
        style={{ cursor: "pointer" }}
        onClick={() => onNavigate(node.id)}
      >
        <circle
          cx={x}
          cy={y}
          r={NODE_RADIUS}
          fill={fill}
          stroke={strokeColor}
          stroke-width={strokeWidth}
        />
        {isPass && (
          <text
            x={x}
            y={y}
            text-anchor="middle"
            dominant-baseline="central"
            font-size={8}
            fill="#888"
          >
            –
          </text>
        )}
        {!isPass && (
          <text
            x={x}
            y={y}
            text-anchor="middle"
            dominant-baseline="central"
            font-size={8}
            fill={stone === 1 ? "#fff" : "#222"}
          >
            {node.col + 1}
          </text>
        )}
      </g>,
    );
  }

  return (
    <div
      class="move-tree"
      ref={containerRef}
      style={{
        overflowX: "auto",
        overflowY: "auto",
        maxHeight: "120px",
        minHeight: "40px",
      }}
    >
      <svg width={svgWidth} height={svgHeight}>
        {edges}
        {nodes}
      </svg>
    </div>
  );
}
