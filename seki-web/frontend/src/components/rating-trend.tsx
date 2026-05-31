const TREND_WIDTH = 48;
const TREND_HEIGHT = 16;

export function buildRatingTrendPath(values: number[]): string {
  if (values.length === 0) {
    return "";
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const xRange = values.length - 1 || 1;

  return values
    .map((value, index) => {
      const x = (index / xRange) * TREND_WIDTH;
      const y = ((max - value) / range) * TREND_HEIGHT;
      return `${index === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");
}

export function RatingTrend({ values }: { values: number[] }) {
  const path = buildRatingTrendPath(values);

  if (!path) {
    return <span class="rating-trend-empty" aria-label="No rating trend" />;
  }

  const stroke =
    values.length > 1
      ? values.at(-1)! > values[0]
        ? "var(--green)"
        : "var(--red)"
      : "none";

  return (
    <svg
      class="rating-trend"
      stroke={stroke}
      viewBox={`0 0 ${TREND_WIDTH} ${TREND_HEIGHT}`}
      role="img"
      aria-label="Rating trend"
    >
      <path d={path} />
    </svg>
  );
}
