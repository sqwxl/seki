import { h, type RefObject } from "preact";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { placeTree } from "../game/move-tree-layout";
import type { GameTreeData } from "../game/types";
import { useIsDesktop } from "../utils/media-query";

const BASE_NODE_RADIUS = 12;
const BASE_COLUMN_SPACING = 32;
const BASE_TRACK_SPACING = 34;
const BASE_PADDING = 20;

type MoveTreeProps = {
  tree: GameTreeData;
  currentNodeId: number;
  direction?: "horizontal" | "vertical";
  mainLineTipNodeId?: number;
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
  mainLineTipNodeId,
  verticalGrowth = "auto",
  onNavigate,
}: MoveTreeProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const isDesktop = useIsDesktop();
  const containerLayout = useContainerLayout(scrollRef);
  const placement = useMemo(
    () => placeTree(tree, mainLineTipNodeId),
    [tree, mainLineTipNodeId],
  );
  const resolvedDirection = direction ?? containerLayout.direction;
  const vertical = resolvedDirection === "vertical";
  const resolvedGrowth =
    verticalGrowth === "auto" ? containerLayout.growth : verticalGrowth;
  const scale = isDesktop ? 2 : 1;
  const nodeRadius = BASE_NODE_RADIUS * scale;
  const columnSpacing = BASE_COLUMN_SPACING * scale;
  const trackSpacing = BASE_TRACK_SPACING * scale;
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

  // Latest mainline node — target for double-tap on empty space.
  const mainlineTipId = useMemo(() => {
    if (
      mainLineTipNodeId != null &&
      mainLineTipNodeId >= 0 &&
      mainLineTipNodeId < tree.nodes.length
    ) {
      return mainLineTipNodeId;
    }

    let id = tree.root_children[0];
    const seen = new Set<number>();

    while (id != null && id < tree.nodes.length && !seen.has(id)) {
      seen.add(id);
      const kids = tree.nodes[id].children;
      if (kids.length === 0) break;
      id = kids[0];
    }

    return id;
  }, [tree, mainLineTipNodeId]);

  const lastTapAt = useRef(0);

  function jumpToMainlineTip(target: EventTarget | null): void {
    // Only empty space (container or svg background), not nodes/edges
    if (target !== scrollRef.current && target !== svgRef.current) {
      return;
    }

    if (mainlineTipId == null || mainlineTipId === currentNodeId) {
      return;
    }

    onNavigate(mainlineTipId);
  }

  const maxColumn = placement.reduce(
    (m, n) => (n ? Math.max(m, n.column) : m),
    0,
  );
  const maxTrack = placement.reduce(
    (m, n) => (n ? Math.max(m, n.track) : m),
    0,
  );

  const svgWidth = vertical
    ? maxTrack * trackSpacing + treeEdgePadding * 2
    : maxColumn * columnSpacing + treeEdgePadding * 2;
  const svgHeight = vertical
    ? maxColumn * columnSpacing + treeEdgePadding * 2
    : maxTrack * trackSpacing + treeEdgePadding * 2;

  function cx(column: number, track: number): number {
    if (!vertical) {
      return treeEdgePadding + column * columnSpacing;
    }

    return resolvedGrowth === "left"
      ? svgWidth - treeEdgePadding - track * trackSpacing
      : treeEdgePadding + track * trackSpacing;
  }
  function cy(column: number, track: number): number {
    return vertical
      ? treeEdgePadding + column * columnSpacing
      : treeEdgePadding + track * trackSpacing;
  }

  // Auto-scroll to keep current node visible.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const svg = svgRef.current;

    if (!el || !svg) {
      return;
    }

    const scrollEl = el;
    const svgEl = svg;
    let frames: number[] = [];

    function clearFrames(): void {
      for (const frame of frames) {
        cancelAnimationFrame(frame);
      }
      frames = [];
    }

    function currentPoint(): { x: number; y: number } | undefined {
      let x: number;
      let y: number;

      if (currentNodeId === -1) {
        x = cx(0, 0);
        y = cy(0, 0);
      } else {
        const cur = placement.find((n) => n && n.id === currentNodeId);

        if (!cur) {
          return undefined;
        }

        x = cx(cur.column, cur.track);
        y = cy(cur.column, cur.track);
      }

      const scrollRect = scrollEl.getBoundingClientRect();
      const svgRect = svgEl.getBoundingClientRect();

      return {
        x: scrollEl.scrollLeft + svgRect.left - scrollRect.left + x,
        y: scrollEl.scrollTop + svgRect.top - scrollRect.top + y,
      };
    }

    function scrollToCurrent(): void {
      const point = currentPoint();

      if (!point) {
        return;
      }

      const w = scrollEl.clientWidth;
      const h = scrollEl.clientHeight;

      if (w === 0 || h === 0) {
        return;
      }

      const pad = vertical ? treeEdgePadding : padding;
      const sl = scrollEl.scrollLeft;
      const st = scrollEl.scrollTop;
      let nextLeft = sl;
      let nextTop = st;

      if (point.x - pad < sl) {
        nextLeft = point.x - pad;
      } else if (point.x + pad > sl + w) {
        nextLeft = point.x + pad - w;
      }

      if (point.y - pad < st) {
        nextTop = point.y - pad;
      } else if (point.y + pad > st + h) {
        nextTop = point.y + pad - h;
      }

      const maxLeft = Math.max(0, scrollEl.scrollWidth - w);
      const maxTop = Math.max(0, scrollEl.scrollHeight - h);

      nextLeft = Math.min(maxLeft, Math.max(0, nextLeft));
      nextTop = Math.min(maxTop, Math.max(0, nextTop));

      if (nextLeft !== sl || nextTop !== st) {
        scrollEl.scrollTo({
          left: nextLeft,
          top: nextTop,
          behavior: "auto",
        });
      }
    }

    function scheduleScroll(): void {
      clearFrames();
      const firstFrame = requestAnimationFrame(() => {
        scrollToCurrent();
        const secondFrame = requestAnimationFrame(() => {
          scrollToCurrent();
          frames = [];
        });
        frames = [secondFrame];
      });
      frames = [firstFrame];
    }

    scheduleScroll();

    if (typeof ResizeObserver === "undefined") {
      return clearFrames;
    }

    const observer = new ResizeObserver(scheduleScroll);
    observer.observe(scrollEl);
    const parentEl = scrollEl.parentElement;

    if (parentEl) {
      observer.observe(parentEl);
    }

    const mutationObserver =
      typeof MutationObserver === "undefined" || !parentEl
        ? undefined
        : new MutationObserver(scheduleScroll);

    if (parentEl) {
      mutationObserver?.observe(parentEl, {
        attributeFilter: ["class", "style"],
        attributes: true,
      });
    }

    return () => {
      clearFrames();
      observer.disconnect();
      mutationObserver?.disconnect();
    };
  }, [
    currentNodeId,
    tree,
    placement,
    resolvedDirection,
    resolvedGrowth,
    maxTrack,
    maxColumn,
    isDesktop,
  ]);

  if (placement.length === 0) {
    return null;
  }

  // Build edges
  const inactiveEdges: h.JSX.Element[] = [];
  const activeEdges: h.JSX.Element[] = [];

  for (const node of placement) {
    if (!node) {
      continue;
    }

    const treeNode = tree.nodes[node.id];

    if (treeNode.parent != null) {
      const parentLayout = placement[treeNode.parent];

      if (parentLayout) {
        const x1 = cx(parentLayout.column, parentLayout.track);
        const y1 = cy(parentLayout.column, parentLayout.track);
        const x2 = cx(node.column, node.track);
        const y2 = cy(node.column, node.track);

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
            ? `H ${x2 + s * columnSpacing}`
            : `V ${y2 - columnSpacing}`;
          const c = columnSpacing * 0.5; // curvature
          const C = vertical
            ? `C ${x2 + s * c},${y1} ${x2},${y2 - c} ${x2},${y2}`
            : `C ${x1},${y2 - columnSpacing + c} ${x2 - c},${y2} ${x2},${y2}`;
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

  for (const node of placement) {
    if (!node) {
      continue;
    }

    const treeNode = tree.nodes[node.id];
    const x = cx(node.column, node.track);
    const y = cy(node.column, node.track);
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
            {node.column}
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
        touchAction: "manipulation",
      }}
      onDblClick={(e) => jumpToMainlineTip(e.target)}
      onTouchEnd={(e) => {
        const now = Date.now();
        const isDoubleTap = now - lastTapAt.current < 300;
        lastTapAt.current = now;

        if (isDoubleTap) {
          jumpToMainlineTip(e.target);
        }
      }}
    >
      <svg
        ref={svgRef}
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
