import type { JSX } from "preact";
import { alpha } from "./helper";

interface CoordXProps {
  style?: JSX.CSSProperties;
  xs: number[];
  coordX?: (i: number) => string;
}

export function CoordX({
  style,
  xs,
  coordX = (i) => alpha[i] || alpha[alpha.length - 1],
}: CoordXProps): JSX.Element {
  return (
    <div
      className="shudan-coordx"
      style={{ display: "flex", textAlign: "center", ...style }}
    >
      {xs.map((i) => (
        <div key={i} style={{ width: "1em" }}>
          <span style={{ display: "block" }}>{coordX(i)}</span>
        </div>
      ))}
    </div>
  );
}

interface CoordYProps {
  style?: JSX.CSSProperties;
  height: number;
  ys: number[];
  coordY?: (i: number) => number | string;
}

export function CoordY({
  style,
  height,
  ys,
  coordY = (i) => height - i,
}: CoordYProps): JSX.Element {
  return (
    <div
      className="shudan-coordy"
      style={{ textAlign: "center", ...style }}
    >
      {ys.map((i) => (
        <div key={i} style={{ height: "1em" }}>
          <span style={{ display: "block" }}>{coordY(i)}</span>
        </div>
      ))}
    </div>
  );
}
