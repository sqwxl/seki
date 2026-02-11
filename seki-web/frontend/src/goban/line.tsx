import type { JSX } from "preact";
import type { Position } from "./types";
import { vertexEquals } from "./helper";

interface LineProps {
  v1: Position;
  v2: Position;
  type?: string;
  vertexSize: number;
}

export default function Line({
  v1,
  v2,
  type = "line",
  vertexSize,
}: LineProps): JSX.Element | null {
  if (vertexEquals(v1, v2)) return null;

  const [pos1, pos2] = [v1, v2].map((v) => v.map((x) => x * vertexSize));
  const [dx, dy] = pos1.map((x, i) => pos2[i] - x);
  const [left, top] = pos1.map((x, i) => (x + pos2[i] + vertexSize) / 2);

  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const length = Math.sqrt(dx * dx + dy * dy);
  const right = left + length;

  const arrowPart =
    type === "arrow"
      ? (() => {
          const x1 = right - vertexSize / 2;
          const y1 = top - vertexSize / 4;
          const x2 = right - vertexSize / 2;
          const y2 = top + vertexSize / 4;
          return `L ${x1} ${y1} M ${right} ${top} L ${x2} ${y2}`;
        })()
      : "";

  return (
    <path
      className={`shudan-${type}`}
      d={`M ${left} ${top} h ${length} ${arrowPart}`}
      transform={`rotate(${angle} ${left} ${top}) translate(${-length / 2} 0)`}
    />
  );
}
