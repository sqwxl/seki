import type { JSX } from "preact";
import { useMemo } from "preact/hooks";
import type { Point } from "./types";

type GridProps = {
  cols: number;
  rows: number;
  hoshis: Point[];
};

export default function Grid({ cols, rows, hoshis }: GridProps): JSX.Element {
  return useMemo(
    () => (
      <svg
        className="goban-grid"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          zIndex: 0,
        }}
        viewBox={`-0.5 -0.5 ${cols} ${rows}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {Array.from({ length: rows }, (_, y) => (
          <line
            key={`h${y}`}
            className="goban-gridline"
            x1={0}
            y1={y}
            x2={cols - 1}
            y2={y}
          />
        ))}
        {Array.from({ length: cols }, (_, x) => (
          <line
            key={`v${x}`}
            className="goban-gridline"
            x1={x}
            y1={0}
            x2={x}
            y2={rows - 1}
          />
        ))}
        {hoshis.map(([x, y]) => (
          <circle
            key={`h${x}-${y}`}
            className="goban-hoshi"
            cx={x}
            cy={y}
            r={0.08}
            fill="currentColor"
          />
        ))}
      </svg>
    ),
    [cols, rows, hoshis],
  );
}
