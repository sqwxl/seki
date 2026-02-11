import type { JSX } from "preact";
import { useMemo } from "preact/hooks";
import type { Position } from "./types";

interface GridProps {
  vertexSize: number;
  width: number;
  height: number;
  xs: number[];
  ys: number[];
  hoshis: Position[];
}

export default function Grid({
  vertexSize,
  width,
  height,
  xs,
  ys,
  hoshis,
}: GridProps): JSX.Element | null {
  const halfVertexSize = vertexSize / 2;
  const fl = Math.floor;

  return useMemo(
    () =>
      xs.length > 0 && ys.length > 0 ? (
        <svg
          className="shudan-grid"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            zIndex: 0,
          }}
        >
          {ys.map((_, i) => {
            const x = xs[0] === 0 ? halfVertexSize : 0;
            return (
              <rect
                key={`h${i}`}
                className="shudan-gridline shudan-horizontal"
                x={fl(x)}
                y={fl((2 * i + 1) * halfVertexSize - 0.5)}
                width={
                  xs[xs.length - 1] === width - 1
                    ? (2 * xs.length - 1) * halfVertexSize - x
                    : xs.length * vertexSize - x
                }
                height={1}
              />
            );
          })}
          {xs.map((_, i) => {
            const y = ys[0] === 0 ? halfVertexSize : 0;
            return (
              <rect
                key={`v${i}`}
                className="shudan-gridline shudan-vertical"
                x={fl((2 * i + 1) * halfVertexSize - 0.5)}
                y={fl(y)}
                width={1}
                height={
                  ys[ys.length - 1] === height - 1
                    ? (2 * ys.length - 1) * halfVertexSize - y
                    : ys.length * vertexSize - y
                }
              />
            );
          })}
          {hoshis.map(([x, y]) => {
            const i = xs.indexOf(x);
            const j = ys.indexOf(y);
            if (i < 0 || j < 0) return null;
            return (
              <circle
                key={`${x}-${y}`}
                className="shudan-hoshi"
                cx={fl((2 * i + 1) * halfVertexSize - 0.5) + 0.5}
                cy={fl((2 * j + 1) * halfVertexSize - 0.5) + 0.5}
                r=".1em"
              />
            );
          })}
        </svg>
      ) : null,
    [vertexSize, width, height, xs.length, ys.length, xs[0], ys[0]],
  );
}
