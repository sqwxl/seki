import { useState } from "preact/hooks";
import type {
  NavigateFn,
  ProfileRatingData,
  RatingHistoryEntryData,
} from "../spa/types";
import { formatSize, formatTimeControl } from "../utils/format";
import { formatNumericRating, fullRankText } from "../utils/rating";
import { StoneBlack, StoneWhite } from "./icons";

type RatingGraphPoint = {
  x: number;
  y: number;
  rating: number;
};

export type RatingGraphData = {
  points: RatingGraphPoint[];
  path: string;
  minRating: number;
  maxRating: number;
  currentRating: number;
};

type RatingTooltipState = {
  nodeKey: string;
  entry: RatingHistoryEntryData | null;
  x: number;
  y: number;
};

type RatingGraphNode = {
  key: string;
  point: RatingGraphPoint;
  entry: RatingHistoryEntryData | null;
  href: string | null;
  label: string;
  radius: number;
};

const GRAPH_WIDTH = 640;
const GRAPH_HEIGHT = 220;
const GRAPH_PADDING = 32;

export function buildRatingGraphData(
  history: RatingHistoryEntryData[],
): RatingGraphData | null {
  if (history.length === 0) {
    return null;
  }

  const ratings = [
    history[0].rating_before,
    ...history.map((entry) => entry.rating_after),
  ];
  const minRating = Math.min(...ratings);
  const maxRating = Math.max(...ratings);
  const ratingRange = maxRating - minRating || 1;
  const xRange = ratings.length - 1 || 1;
  const width = GRAPH_WIDTH - GRAPH_PADDING * 2;
  const height = GRAPH_HEIGHT - GRAPH_PADDING * 2;

  const points = ratings.map((rating, index) => ({
    x: GRAPH_PADDING + (index / xRange) * width,
    y: GRAPH_PADDING + ((maxRating - rating) / ratingRange) * height,
    rating,
  }));
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");

  return {
    points,
    path,
    minRating,
    maxRating,
    currentRating: ratings[ratings.length - 1],
  };
}

export function RatingProfileSummary({
  rating,
  navigate,
}: {
  rating: ProfileRatingData;
  navigate: NavigateFn;
}) {
  const rankText = fullRankText(rating.rank);

  return (
    <section>
      <h2>Rating</h2>
      <p style={{ textAlign: "center" }}>
        {rankText}
        {rating.participating ? "" : " (-)"}
        {` · ${rating.rated_games} rated games`}
      </p>
      <RatingGraph history={rating.history} navigate={navigate} />
    </section>
  );
}

function buildRatingGraphNodes(
  graph: RatingGraphData,
  history: RatingHistoryEntryData[],
): RatingGraphNode[] {
  return graph.points.map((point, index) => {
    const entry = history[index - 1] ?? null;
    const isLatest = index === graph.points.length - 1;

    return {
      key: entry ? `game-${entry.game_id}` : "baseline",
      point,
      entry,
      href: entry ? `/games/${entry.game_id}` : null,
      label: formatNumericRating(entry ? entry.rating_after : point.rating),
      radius: isLatest ? 4 : 3,
    };
  });
}

function tooltipPosition(e: MouseEvent): Pick<RatingTooltipState, "x" | "y"> {
  return {
    x: Math.max(8, Math.min(e.clientX + 12, window.innerWidth - 272)),
    y: Math.max(8, Math.min(e.clientY + 12, window.innerHeight - 184)),
  };
}

function historyEntrySettings(entry: RatingHistoryEntryData) {
  return {
    cols: entry.cols,
    rows: entry.rows,
    handicap: entry.handicap,
    time_control: entry.time_control,
    main_time_secs: entry.main_time_secs ?? undefined,
    increment_secs: entry.increment_secs ?? undefined,
    byoyomi_time_secs: entry.byoyomi_time_secs ?? undefined,
    byoyomi_periods: entry.byoyomi_periods ?? undefined,
    is_private: false,
    invite_only: false,
  };
}

function RatingGraph({
  history,
  navigate,
}: {
  history: RatingHistoryEntryData[];
  navigate: NavigateFn;
}) {
  const graph = buildRatingGraphData(history);
  const [tooltip, setTooltip] = useState<RatingTooltipState | null>(null);

  if (!graph) {
    return <p class="rating-graph-empty">No visible rated games yet.</p>;
  }

  const nodes = buildRatingGraphNodes(graph, history);
  const showTooltip = (node: RatingGraphNode, e: MouseEvent) => {
    if (!window.matchMedia("(min-width: 768px)").matches) {
      return;
    }

    setTooltip({
      nodeKey: node.key,
      entry: node.entry,
      ...tooltipPosition(e),
    });
  };

  return (
    <div class="rating-graph">
      <svg
        viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
        role="img"
        aria-label={`Rating graph, current rating ${formatNumericRating(graph.currentRating)}`}
      >
        <line
          class="rating-graph-grid"
          x1={GRAPH_PADDING}
          y1={GRAPH_PADDING}
          x2={GRAPH_PADDING}
          y2={GRAPH_HEIGHT - GRAPH_PADDING}
        />
        <line
          class="rating-graph-grid"
          x1={GRAPH_PADDING}
          y1={GRAPH_HEIGHT - GRAPH_PADDING}
          x2={GRAPH_WIDTH - GRAPH_PADDING}
          y2={GRAPH_HEIGHT - GRAPH_PADDING}
        />
        <path class="rating-graph-line" d={graph.path} />
        {nodes.map((node) => (
          <g key={node.key}>
            <circle
              class={`rating-graph-point${node.href ? " rating-graph-game-point" : ""}`}
              cx={node.point.x}
              cy={node.point.y}
              r={node.radius}
              onMouseEnter={(e) => showTooltip(node, e)}
              onMouseMove={(e) => showTooltip(node, e)}
              onMouseLeave={() => setTooltip(null)}
              onClick={() => node.href && navigate(node.href)}
            />
            {tooltip?.nodeKey === node.key && (
              <text
                class="rating-graph-label"
                x={node.point.x}
                y={node.point.y - 10}
              >
                {node.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      <div class="rating-graph-meta">
        <span>
          Range {formatNumericRating(graph.minRating)}-
          {formatNumericRating(graph.maxRating)}
        </span>
        <span>{history.length} games</span>
      </div>
      {tooltip && <RatingGraphTooltip tooltip={tooltip} />}
    </div>
  );
}

function RatingGraphTooltip({ tooltip }: { tooltip: RatingTooltipState }) {
  const { entry } = tooltip;

  if (entry == null) {
    return null;
  }

  const timeControl = formatTimeControl(historyEntrySettings(entry)) ?? "None";

  return (
    <div
      class="rating-graph-tooltip"
      style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }}
    >
      <div>
        <StoneBlack /> {entry.black_player ?? "?"}{" "}
        {fullRankText(entry.black_rank_before) || "(-)"}
      </div>
      <div>
        <StoneWhite /> {entry.white_player ?? "?"}{" "}
        {fullRankText(entry.white_rank_before) || "(-)"}
      </div>
      <div>
        <strong>Board</strong> {formatSize(entry.cols, entry.rows)}
      </div>
      <div>
        <strong>Handicap</strong> {entry.handicap}
      </div>
      <div>
        <strong>Komi</strong> {entry.komi}
      </div>
      <div>
        <strong>Time</strong> {timeControl}
      </div>
      <div>
        <strong>Result</strong> {entry.result}
      </div>
    </div>
  );
}
