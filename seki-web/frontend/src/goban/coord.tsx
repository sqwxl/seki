import type { CSSProperties, JSX } from "preact";

type CoordColsProps = {
  style?: CSSProperties;
  cols: number;
};

const CAPITAL_A_CHAR_CODE = 65;

function colToCoord(i: number): string {
  let coord = String.fromCharCode(CAPITAL_A_CHAR_CODE + i);
  return coord.repeat(1 + (i % 26));
}

function rowToCoord(i: number, rows: number): string {
  return String(rows - i);
}

export function CoordCols({ style, cols }: CoordColsProps): JSX.Element {
  return (
    <div
      className="goban-coordx"
      style={{ display: "flex", textAlign: "center", ...style }}
    >
      {Array(cols).map((i) => (
        <div key={i}>
          <span style={{ display: "block" }}>{colToCoord(i)}</span>
        </div>
      ))}
    </div>
  );
}

type CoordRowsProps = {
  style?: CSSProperties;
  rows: number;
};

export function CoordRows({ style, rows }: CoordRowsProps): JSX.Element {
  return (
    <div className="goban-coordy" style={{ textAlign: "center", ...style }}>
      {Array(rows).map((i) => (
        <div key={i}>
          <span style={{ display: "block" }}>{rowToCoord(i, rows)}</span>
        </div>
      ))}
    </div>
  );
}
