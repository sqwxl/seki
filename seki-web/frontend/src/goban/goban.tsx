import classnames from "classnames";
import type { CSSProperties, HTMLAttributes, JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { CoordCols, CoordRows } from "./coord";
import Grid from "./grid";
import {
  diffSignMap,
  getHoshis,
  neighborhood,
  random,
  readjustShifts,
  vertexEquals,
} from "./helper";
import Line from "./line";
import type {
  GhostStoneData,
  HeatData,
  LineData,
  MarkerData,
  Point,
  VertexEventHandler,
} from "./types";
import Vertex from "./vertex";

export type GobanProps = {
  id?: string;
  class?: string;
  cols: number;
  rows: number;
  innerProps?: HTMLAttributes<HTMLDivElement>;
  style?: CSSProperties;
  vertexSize: number;
  busy?: boolean;
  signMap: number[];
  paintMap?: (number | null)[];
  heatMap?: (HeatData | null)[];
  markerMap?: (MarkerData | null)[];
  ghostStoneMap?: (GhostStoneData | null)[];
  fuzzyStonePlacement?: boolean;
  showCoordinates?: boolean;
  animateStonePlacement?: boolean;
  animationDuration?: number;
  lines?: LineData[];
  selectedVertices?: Point[];
  dimmedVertices?: Point[];
  onVertexClick?: VertexEventHandler;
};

type AnimState = {
  cols: number;
  rows: number;
  shiftMap: number[];
  randomMap: number[];
  prevSignMap: number[];
  animatedVertices: number[];
  clearHandler: ReturnType<typeof setTimeout> | null;
};

function initAnimState(cols: number, rows: number, signMap: number[]): AnimState {
  const size = cols * rows;
  return {
    cols,
    rows,
    shiftMap: Array.from({ length: size }, () => random(8)),
    randomMap: Array.from({ length: size }, () => random(4)),
    prevSignMap: signMap,
    animatedVertices: [],
    clearHandler: null,
  };
}

export default function SVGGoban(props: GobanProps): JSX.Element {
  const {
    cols,
    rows,
    signMap,
    innerProps = {},
    vertexSize,
    busy,
    paintMap,
    heatMap,
    markerMap,
    ghostStoneMap,
    fuzzyStonePlacement = false,
    showCoordinates = false,
    animateStonePlacement,
    animationDuration = 200,
    lines = [],
    selectedVertices = [],
    dimmedVertices = [],
  } = props;

  const hoshis = useMemo(() => getHoshis(cols, rows), [cols, rows]);

  // Persistent animation state — reset when dimensions change, mutated in
  // place during the animation cycle (safe in Preact, no concurrent mode).
  const ref = useRef<AnimState | null>(null);
  if (!ref.current || ref.current.cols !== cols || ref.current.rows !== rows) {
    ref.current = initAnimState(cols, rows, signMap);
  } else if (
    animateStonePlacement &&
    fuzzyStonePlacement &&
    !ref.current.clearHandler
  ) {
    ref.current.animatedVertices = diffSignMap(ref.current.prevSignMap, signMap);
    ref.current.prevSignMap = signMap;
  } else {
    ref.current.animatedVertices = [];
    ref.current.prevSignMap = signMap;
  }

  const s = ref.current;
  const { shiftMap, randomMap, animatedVertices } = s;

  // Trigger re-render when animation updates shiftMap or clears vertices
  const [, rerender] = useState(0);

  // Animation effect — runs after render (mirrors componentDidUpdate)
  useEffect(() => {
    if (
      animateStonePlacement &&
      !s.clearHandler &&
      animatedVertices.length > 0
    ) {
      for (const i of animatedVertices) {
        shiftMap[i] = random(7) + 1;
        readjustShifts(shiftMap, cols, i);
      }

      s.clearHandler = setTimeout(() => {
        s.animatedVertices = [];
        s.clearHandler = null;
        rerender((c) => c + 1);
      }, animationDuration);

      rerender((c) => c + 1);
    }
  });

  // Build animated neighbor set
  const animatedSet = new Set<number>();
  for (const i of animatedVertices) {
    for (const pt of neighborhood([i % cols, Math.floor(i / cols)])) {
      if (pt[0] >= 0 && pt[0] < cols && pt[1] >= 0 && pt[1] < rows) {
        animatedSet.add(pt[1] * cols + pt[0]);
      }
    }
  }

  return (
    <div
      {...(innerProps as HTMLAttributes<HTMLDivElement>)}
      id={props.id}
      className={classnames(
        "goban",
        "goban-image",
        {
          "goban-busy": busy,
          "goban-coordinates": showCoordinates,
        },
        props.class,
      )}
      style={{
        display: "inline-grid",
        gridTemplateRows: showCoordinates ? "1em 1fr 1em" : "1fr",
        gridTemplateColumns: showCoordinates ? "1em 1fr 1em" : "1fr",
        fontSize: vertexSize,
        lineHeight: "1em",
        ...(props.style ?? {}),
      }}
    >
      {showCoordinates && (
        <CoordCols cols={cols} style={{ gridRow: "1", gridColumn: "2" }} />
      )}
      {showCoordinates && (
        <CoordRows rows={rows} style={{ gridRow: "2", gridColumn: "1" }} />
      )}

      <div
        className="goban-content"
        style={{
          position: "relative",
          width: `${cols}em`,
          height: `${rows}em`,
          gridRow: showCoordinates ? "2" : "1",
          gridColumn: showCoordinates ? "2" : "1",
        }}
      >
        <Grid cols={cols} rows={rows} hoshis={hoshis} />

        <div
          className="goban-vertices"
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, 1em)`,
            gridTemplateRows: `repeat(${rows}, 1em)`,
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 1,
          }}
        >
          {Array.from({ length: cols * rows }, (_, i) => {
            const x = i % cols;
            const y = Math.floor(i / cols);
            const equalsVertex = (v: Point) => vertexEquals(v, [x, y]);
            const isSelected = selectedVertices.some(equalsVertex);

            return (
              <Vertex
                key={i}
                position={[x, y]}
                shift={fuzzyStonePlacement ? shiftMap?.[i] : 0}
                random={randomMap?.[i]}
                sign={signMap?.[i]}
                heat={heatMap?.[i]}
                marker={markerMap?.[i]}
                ghostStone={ghostStoneMap?.[i]}
                dimmed={dimmedVertices.some(equalsVertex)}
                animate={animatedSet.has(i)}
                paint={paintMap?.[i]}
                paintLeft={x > 0 ? paintMap?.[i - 1] : undefined}
                paintRight={x < cols - 1 ? paintMap?.[i + 1] : undefined}
                paintTop={y > 0 ? paintMap?.[i - cols] : undefined}
                paintBottom={y < rows - 1 ? paintMap?.[i + cols] : undefined}
                paintTopLeft={
                  x > 0 && y > 0 ? paintMap?.[i - cols - 1] : undefined
                }
                paintTopRight={
                  x < cols - 1 && y > 0 ? paintMap?.[i - cols + 1] : undefined
                }
                paintBottomLeft={
                  x > 0 && y < rows - 1 ? paintMap?.[i + cols - 1] : undefined
                }
                paintBottomRight={
                  x < cols - 1 && y < rows - 1
                    ? paintMap?.[i + cols + 1]
                    : undefined
                }
                selected={isSelected}
                selectedLeft={
                  isSelected &&
                  selectedVertices.some((v: Point) =>
                    vertexEquals(v, [x - 1, y]),
                  )
                }
                selectedRight={
                  isSelected &&
                  selectedVertices.some((v: Point) =>
                    vertexEquals(v, [x + 1, y]),
                  )
                }
                selectedTop={
                  isSelected &&
                  selectedVertices.some((v: Point) =>
                    vertexEquals(v, [x, y - 1]),
                  )
                }
                selectedBottom={
                  isSelected &&
                  selectedVertices.some((v: Point) =>
                    vertexEquals(v, [x, y + 1]),
                  )
                }
                onClick={props.onVertexClick}
              />
            );
          })}
        </div>

        {lines.length > 0 && (
          <svg
            className="goban-lines"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              pointerEvents: "none",
              zIndex: 2,
            }}
            viewBox={`-0.5 -0.5 ${cols} ${rows}`}
          >
            {lines.map(({ v1, v2, type }: LineData, i: number) => (
              <Line key={i} v1={v1} v2={v2} type={type} />
            ))}
          </svg>
        )}
      </div>

      {showCoordinates && (
        <CoordRows rows={rows} style={{ gridRow: "2", gridColumn: "3" }} />
      )}
      {showCoordinates && (
        <CoordCols cols={cols} style={{ gridRow: "3", gridColumn: "2" }} />
      )}
    </div>
  );
}
