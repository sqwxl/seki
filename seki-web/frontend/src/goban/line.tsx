import type { JSX } from "preact";
import type { Point } from "./types";
import { vertexEquals } from "./helper";

type LineProps = {
  v1: Point;
  v2: Point;
  type?: string;
};

export default function Line({
  v1,
  v2,
  type = "line",
}: LineProps): JSX.Element | null {
  if (vertexEquals(v1, v2)) return null;

  const [x1, y1] = v1;
  const [x2, y2] = v2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;

  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const length = Math.sqrt(dx * dx + dy * dy);

  const arrowSize = 0.25;
  const arrowPart =
    type === "arrow"
      ? `L ${length / 2} ${-arrowSize} M ${length / 2} 0 L ${length / 2} ${arrowSize}`
      : "";

  return (
    <path
      className={`goban-${type}`}
      d={`M ${-length / 2} 0 h ${length} ${arrowPart}`}
      transform={`translate(${cx} ${cy}) rotate(${angle})`}
    />
  );
}
