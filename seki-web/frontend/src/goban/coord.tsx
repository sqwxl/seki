import type { CSSProperties, JSX } from "preact";

type CoordColsProps = {
  style?: CSSProperties;
  cols: number;
};

const CAPITAL_A_CHAR_CODE = 65;

function colToCoord(i: number): string {
  // Standard Go notation skips 'I' to avoid confusion with 'J'
  const code = CAPITAL_A_CHAR_CODE + i + (i >= 8 ? 1 : 0);
  return String.fromCharCode(code);
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
      {Array.from({ length: cols }, (_, i) => (
        <div key={i} style={{ flex: 1 }}>
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
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ flex: 1 }}>
          <span style={{ display: "block" }}>{rowToCoord(i, rows)}</span>
        </div>
      ))}
    </div>
  );
}
