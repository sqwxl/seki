import { useState } from "preact/hooks";
import type {
  NavigateFn,
  ProfileRatingData,
  RatingHistoryEntryData,
} from "../spa/types";
import { formatSize, formatTimeControl } from "../utils/format";
import { formatNumericRating, fullRankText } from "../utils/rating";
import { IconTrendDown, IconTrendUp, StoneBlack, StoneWhite } from "./icons";

type RatingGraphPoint = {
  x: number;
  y: number;
  rating: number;
};

export type RatingGridLine = {
  rating: number;
  y: number;
};

export type RatingGraphData = {
  points: RatingGraphPoint[];
  gridLines: RatingGridLine[];
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

const NICE_STEPS = [10, 20, 25, 50, 100, 150, 200, 250];
const MIN_GRID_LINES = 5;
const MIN_STEP = 10;
const MAX_STEP = 250;

function niceStep(span: number): number {
  const raw = span / (MIN_GRID_LINES - 1);
  let best = NICE_STEPS[0];
  for (const s of NICE_STEPS) {
    if (Math.abs(s - raw) < Math.abs(best - raw)) {
      best = s;
    }
  }
  return Math.max(MIN_STEP, Math.min(MAX_STEP, best));
}

function computeGridLines(
  dataMin: number,
  dataMax: number,
  plotHeight: number,
): { lines: RatingGridLine[]; gridMin: number; gridMax: number } {
  const span = dataMax - dataMin || 100;
  const step = niceStep(span);

  let gridMin = Math.floor(dataMin / step) * step;
  let gridMax = Math.ceil(dataMax / step) * step;

  while ((gridMax - gridMin) / step < MIN_GRID_LINES - 1) {
    gridMin -= step;
    if ((gridMax - gridMin) / step >= MIN_GRID_LINES - 1) break;
    gridMax += step;
  }

  const gridSpan = gridMax - gridMin || 1;
  const lines: RatingGridLine[] = [];
  for (let r = gridMin; r <= gridMax + 0.001; r += step) {
    lines.push({
      rating: r,
      y: GRAPH_PADDING + ((gridMax - r) / gridSpan) * plotHeight,
    });
  }

  return { lines, gridMin, gridMax };
}

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
  const dataMin = Math.min(...ratings);
  const dataMax = Math.max(...ratings);
  const plotHeight = GRAPH_HEIGHT - GRAPH_PADDING * 2;
  const width = GRAPH_WIDTH - GRAPH_PADDING * 2;
  const xRange = ratings.length - 1 || 1;

  const {
    lines: gridLines,
    gridMin,
    gridMax,
  } = computeGridLines(dataMin, dataMax, plotHeight);
  const gridSpan = gridMax - gridMin || 1;

  const points = ratings.map((rating, index) => ({
    x: GRAPH_PADDING + (index / xRange) * width,
    y: GRAPH_PADDING + ((gridMax - rating) / gridSpan) * plotHeight,
    rating,
  }));
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");

  return {
    points,
    gridLines,
    path,
    minRating: gridMin,
    maxRating: gridMax,
    currentRating: ratings[ratings.length - 1],
  };
}

function ratingProgression12(history: RatingHistoryEntryData[]): number {
  const last12 = history.slice(-12);
  return last12.reduce((sum, e) => sum + e.rating_delta, 0);
}

function formatTimeSpent(totalSecs: number): string {
  const days = Math.floor(totalSecs / 86400);
  const hours = Math.floor((totalSecs % 86400) / 3600);
  const minutes = Math.floor((totalSecs % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(" ");
}

function pct(part: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

function formatStreak(streak: number, cl: string) {
  return streak === 0 ? "-" : <span class={cl}>{streak} games</span>;
}

export function RatingProfileSummary({
  rating,
  navigate,
}: {
  rating: ProfileRatingData;
  navigate: NavigateFn;
}) {
  const { stats } = rating;
  const prog12 = ratingProgression12(rating.history);
  const progSign = prog12 >= 0 ? <IconTrendUp /> : <IconTrendDown />;

  return (
    <section class="stats-section">
      <RatingGraph history={rating.history} navigate={navigate} />

      <div>
        <h2>Rating: {formatNumericRating(rating.rating, 2)}</h2>
        <p class="rating-progression">
          Progression over the last 12 games:{" "}
          <strong class={prog12 > 0 ? "fg-green" : "fg-red"}>
            {progSign}
            {formatNumericRating(prog12)}
          </strong>
          . Rating deviation:{" "}
          <strong>{formatNumericRating(rating.deviation)}</strong>
        </p>
      </div>

      <div class="rating-stats-tables">
        <table class="rating-summary">
          <tbody>
            <tr>
              <td>Total games</td>
              <td>{stats.total_games}</td>
            </tr>
            <tr>
              <td>Rated games</td>
              <td>{stats.rated_games}</td>
            </tr>
            <tr>
              <td>Time spent playing</td>
              <td colspan={2}>{formatTimeSpent(stats.time_spent_secs)}</td>
            </tr>
          </tbody>
        </table>

        <table class="rating-summary">
          <tbody>
            <tr>
              <td>Average opponent</td>
              <td>
                {stats.avg_opponent_rating != null
                  ? formatNumericRating(stats.avg_opponent_rating, 2)
                  : "-"}
              </td>
              <td></td>
            </tr>
            <tr>
              <td>Wins</td>
              <td class="fg-green">{stats.wins}</td>
              <td class="fg-green">{pct(stats.wins, stats.total_games)}</td>
            </tr>
            <tr>
              <td>Losses</td>
              <td class="fg-red">{stats.losses}</td>
              <td class="fg-red">{pct(stats.losses, stats.total_games)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div>
        <div class="rating-extremes">
          <div>
            Highest rating:{" "}
            {stats.highest_rating != null ? (
              <span class="fg-green">
                {formatNumericRating(stats.highest_rating)}
              </span>
            ) : (
              "-"
            )}
          </div>
          <div>
            Lowest rating:{" "}
            {stats.lowest_rating != null ? (
              <span class="fg-red">
                {formatNumericRating(stats.lowest_rating)}
              </span>
            ) : (
              "-"
            )}
          </div>
        </div>
        <div class="rating-streaks">
          <div>
            <strong>Winning streak</strong>
            <ul>
              <li>
                Longest: {formatStreak(stats.win_streak_longest, "fg-green")}
              </li>
              <li>
                Current: {formatStreak(stats.win_streak_current, "fg-green")}
              </li>
            </ul>
          </div>
          <div>
            <strong>Losing streak</strong>
            <ul>
              <li>
                Longest: {formatStreak(stats.lose_streak_longest, "fg-red")}
              </li>
              <li>
                Current: {formatStreak(stats.lose_streak_current, "fg-red")}
              </li>
            </ul>
          </div>
        </div>{" "}
      </div>
    </section>
  );
}

function buildRatingGraphNodes(
  graph: RatingGraphData,
  history: RatingHistoryEntryData[],
  anchorEntry: RatingHistoryEntryData | null = null,
): RatingGraphNode[] {
  return graph.points.map((point, index) => {
    const isFirst = index === 0;
    const entry = isFirst ? anchorEntry : (history[index - 1] ?? null);
    const isLatest = index === graph.points.length - 1;

    return {
      key: entry ? `game-${entry.game_id}-${index}` : "baseline",
      point,
      entry,
      href: entry ? `/games/${entry.game_id}` : null,
      label: formatNumericRating(
        entry && !isFirst ? entry.rating_after : point.rating,
      ),
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

type TimeRange = "1m" | "3m" | "all";

function filterByTimeRange(
  history: RatingHistoryEntryData[],
  range: TimeRange,
): RatingHistoryEntryData[] {
  if (range === "all") return history;
  const cutoffDays = range === "1m" ? 30 : 90;
  const cutoff = Date.now() - cutoffDays * 24 * 60 * 60 * 1000;
  return history.filter((e) => new Date(e.created_at).getTime() >= cutoff);
}

function RatingGraph({
  history,
  navigate,
}: {
  history: RatingHistoryEntryData[];
  navigate: NavigateFn;
}) {
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  const filtered = filterByTimeRange(history, timeRange);
  const graph = buildRatingGraphData(filtered);
  const [tooltip, setTooltip] = useState<RatingTooltipState | null>(null);

  if (!graph) {
    return <p class="rating-graph-empty">No visible rated games yet.</p>;
  }

  const anchorEntry =
    filtered.length > 0 && filtered.length < history.length
      ? (() => {
          const target = filtered[0].rating_before;
          const match = history.findLast((e) => e.rating_after === target);
          return match ?? null;
        })()
      : null;
  const nodes = buildRatingGraphNodes(graph, filtered, anchorEntry);
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

  const rangeLabel = (r: TimeRange) => {
    if (r === "all") return "All";
    if (r === "1m") return "1m";
    return "3m";
  };

  const RANGES: TimeRange[] = ["1m", "3m", "all"];

  return (
    <div class="rating-graph">
      <div class="controls-group" style={{ fontSize: "0.8em" }}>
        <span class="btn-group">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              class={`btn${timeRange === r ? " btn-active" : ""}`}
              aria-pressed={timeRange === r}
              onClick={() => setTimeRange(r)}
            >
              {rangeLabel(r)}
            </button>
          ))}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
        role="img"
        aria-label={`Rating graph, current rating ${formatNumericRating(graph.currentRating)}`}
      >
        {graph.gridLines.map((gl) => (
          <g key={gl.rating}>
            <line
              class="rating-graph-grid"
              x1={GRAPH_PADDING}
              y1={gl.y}
              x2={GRAPH_WIDTH - GRAPH_PADDING}
              y2={gl.y}
            />
            <text
              class="rating-graph-grid-label"
              x={GRAPH_WIDTH - GRAPH_PADDING}
              y={gl.y + 11}
              text-anchor="end"
            >
              {formatNumericRating(gl.rating)}
            </text>
          </g>
        ))}
        <path class="rating-graph-line" d={graph.path} />
        {nodes.map((node) => (
          <g key={node.key}>
            <circle
              class="rating-graph-hitarea"
              cx={node.point.x}
              cy={node.point.y}
              r={node.radius * 4}
              onMouseEnter={(e) => showTooltip(node, e)}
              onMouseMove={(e) => showTooltip(node, e)}
              onMouseLeave={() => setTooltip(null)}
              onClick={() => node.href && navigate(node.href)}
            />
            <circle
              class={`rating-graph-point${node.href ? " rating-graph-game-point" : ""}`}
              cx={node.point.x}
              cy={node.point.y}
              r={node.radius}
              style={{ pointerEvents: "none" }}
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
      <div>
        <strong>Finished</strong>{" "}
        {entry.ended_at
          ? new Date(entry.ended_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          : "-"}
      </div>
    </div>
  );
}
