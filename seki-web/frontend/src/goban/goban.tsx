import classnames from "classnames";
import type { CSSProperties, HTMLAttributes, JSX } from "preact";
import { Component } from "preact";

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

type GobanState = {
  cols: number;
  rows: number;
  hoshis: Point[];
  shiftMap: number[];
  randomMap: number[];
  signMap: number[];
  animatedVertices: number[];
  clearAnimatedVerticesHandler: ReturnType<typeof setTimeout> | null;
};

export type GobanProps = {
  id?: string;
  class?: string;
  className?: string;
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

export default class SVGGoban extends Component<GobanProps, GobanState> {
  constructor(props: GobanProps) {
    super(props);
    this.state = {} as GobanState;
  }

  idx(pt: Point): number;
  idx(x: number, y: number): number;
  idx(a: Point | number, b?: number): number {
    if (typeof a === "number") {
      return b! * this.props.cols + a;
    }
    return a[1] * this.props.cols + a[0];
  }

  pnt(i: number): Point {
    return [i % this.props.cols, Math.floor(i / this.props.cols)];
  }

  static getDerivedStateFromProps(
    props: GobanProps,
    state: GobanState,
  ): Partial<GobanState> | null {
    const { cols, rows, signMap } = props;
    const size = cols * rows;

    if (state.cols !== cols || state.rows !== rows) {
      return {
        cols,
        rows,
        signMap,
        hoshis: getHoshis(cols, rows),
        shiftMap: Array.from({ length: size }, () => random(8)),
        randomMap: Array.from({ length: size }, () => random(4)),
        animatedVertices: [],
        clearAnimatedVerticesHandler: null,
      };
    }

    let animatedVertices = state.animatedVertices;
    if (
      props.animateStonePlacement &&
      props.fuzzyStonePlacement &&
      state.clearAnimatedVerticesHandler == null
    ) {
      animatedVertices = diffSignMap(state.signMap, signMap);
    }

    return { signMap, animatedVertices };
  }

  componentDidUpdate(): void {
    if (
      this.props.animateStonePlacement &&
      !this.state.clearAnimatedVerticesHandler &&
      this.state.animatedVertices.length > 0
    ) {
      for (const i of this.state.animatedVertices) {
        this.state.shiftMap[i] = random(7) + 1;
        readjustShifts(this.state.shiftMap, this.props.cols, i);
      }

      this.setState({ shiftMap: this.state.shiftMap });

      this.setState({
        clearAnimatedVerticesHandler: setTimeout(() => {
          this.setState({
            animatedVertices: [],
            clearAnimatedVerticesHandler: null,
          });
        }, this.props.animationDuration ?? 200),
      });
    }
  }

  render(): JSX.Element {
    const { cols, rows, hoshis, shiftMap, randomMap } = this.state;
    const {
      innerProps = {},
      vertexSize,
      busy,
      signMap,
      paintMap,
      heatMap,
      markerMap,
      ghostStoneMap,
      fuzzyStonePlacement = false,
      showCoordinates = false,
      lines = [],
      selectedVertices = [],
      dimmedVertices = [],
    } = this.props;

    const animatedSet = new Set<number>();
    for (const i of this.state.animatedVertices) {
      for (const pt of neighborhood(this.pnt(i))) {
        if (pt[0] >= 0 && pt[0] < cols && pt[1] >= 0 && pt[1] < rows) {
          animatedSet.add(this.idx(pt));
        }
      }
    }

    return (
      <div
        {...(innerProps as HTMLAttributes<HTMLDivElement>)}
        id={this.props.id}
        className={classnames(
          "goban",
          "goban-image",
          {
            "goban-busy": busy,
            "goban-coordinates": showCoordinates,
          },
          this.props.class ?? this.props.className,
        )}
        style={{
          display: "inline-grid",
          gridTemplateRows: showCoordinates ? "1em 1fr 1em" : "1fr",
          gridTemplateColumns: showCoordinates ? "1em 1fr 1em" : "1fr",
          fontSize: vertexSize,
          lineHeight: "1em",
          ...(this.props.style ?? {}),
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
                  onClick={this.props.onVertexClick}
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
}
