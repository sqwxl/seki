import { Component } from "preact";
import type { JSX } from "preact";
import classnames from "classnames";
import type { GobanProps, Position } from "./types";
import { CoordX, CoordY } from "./coord";
import Grid from "./grid";
import Line from "./line";
import Vertex from "./vertex";
import {
  diffSignMap,
  getHoshis,
  neighborhood,
  random,
  range,
  readjustShifts,
  vertexEquals,
} from "./helper";

interface GobanState {
  width: number;
  height: number;
  rangeX: [number, number];
  rangeY: [number, number];
  xs: number[];
  ys: number[];
  hoshis: Position[];
  shiftMap: number[][];
  randomMap: number[][];
  signMap: number[][];
  animatedVertices: Position[];
  clearAnimatedVerticesHandler: ReturnType<typeof setTimeout> | null;
}

export default class Goban extends Component<GobanProps, GobanState> {
  constructor(props: GobanProps) {
    super(props);
    this.state = {} as GobanState;
  }

  static getDerivedStateFromProps(
    props: GobanProps,
    state: GobanState,
  ): Partial<GobanState> | null {
    const {
      signMap = [],
      rangeX = [0, Number.POSITIVE_INFINITY] as [number, number],
      rangeY = [0, Number.POSITIVE_INFINITY] as [number, number],
    } = props;

    const width = signMap.length === 0 ? 0 : signMap[0].length;
    const height = signMap.length;

    if (state.width === width && state.height === height) {
      let animatedVertices = state.animatedVertices;

      if (
        props.animateStonePlacement &&
        props.fuzzyStonePlacement &&
        state.clearAnimatedVerticesHandler == null
      ) {
        animatedVertices = diffSignMap(state.signMap, signMap);
      }

      const result: Partial<GobanState> = {
        signMap,
        animatedVertices,
      };

      if (
        !vertexEquals(state.rangeX, rangeX) ||
        !vertexEquals(state.rangeY, rangeY)
      ) {
        Object.assign(result, {
          rangeX,
          rangeY,
          xs: range(width).slice(rangeX[0], rangeX[1] + 1),
          ys: range(height).slice(rangeY[0], rangeY[1] + 1),
        });
      }

      return result;
    }

    // Board size changed
    return {
      signMap,
      width,
      height,
      rangeX,
      rangeY,
      animatedVertices: [],
      clearAnimatedVerticesHandler: null,
      xs: range(width).slice(rangeX[0], rangeX[1] + 1),
      ys: range(height).slice(rangeY[0], rangeY[1] + 1),
      hoshis: getHoshis(width, height),
      shiftMap: readjustShifts(signMap.map((row) => row.map(() => random(8)))),
      randomMap: signMap.map((row) => row.map(() => random(4))),
    };
  }

  componentDidUpdate(): void {
    if (
      this.props.animateStonePlacement &&
      !this.state.clearAnimatedVerticesHandler &&
      this.state.animatedVertices.length > 0
    ) {
      for (const [x, y] of this.state.animatedVertices) {
        this.state.shiftMap[y][x] = random(7) + 1;
        readjustShifts(this.state.shiftMap, [x, y]);
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
    const {
      width,
      height,
      rangeX,
      rangeY,
      xs,
      ys,
      hoshis,
      shiftMap,
      randomMap,
    } = this.state;

    const {
      innerProps = {},
      vertexSize = 32,
      coordX,
      coordY,
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

    const animatedVertices = ([] as Position[]).concat(
      ...this.state.animatedVertices.map(neighborhood),
    );

    return (
      <div
        {...(innerProps as JSX.HTMLAttributes<HTMLDivElement>)}
        id={this.props.id}
        className={classnames(
          "shudan-goban",
          "shudan-goban-image",
          {
            "shudan-busy": busy,
            "shudan-coordinates": showCoordinates,
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
          <CoordX
            xs={xs}
            style={{ gridRow: "1", gridColumn: "2" }}
            coordX={coordX}
          />
        )}
        {showCoordinates && (
          <CoordY
            height={height}
            ys={ys}
            style={{ gridRow: "2", gridColumn: "1" }}
            coordY={coordY}
          />
        )}

        <div
          className="shudan-content"
          style={{
            position: "relative",
            width: `${xs.length}em`,
            height: `${ys.length}em`,
            gridRow: showCoordinates ? "2" : "1",
            gridColumn: showCoordinates ? "2" : "1",
          }}
        >
          <Grid
            vertexSize={vertexSize}
            width={width}
            height={height}
            xs={xs}
            ys={ys}
            hoshis={hoshis}
          />

          <div
            className="shudan-vertices"
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${xs.length}, 1em)`,
              gridTemplateRows: `repeat(${ys.length}, 1em)`,
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 1,
            }}
          >
            {ys.map((y) =>
              xs.map((x) => {
                const equalsVertex = (v: Position) =>
                  vertexEquals(v, [x, y]);
                const isSelected = selectedVertices.some(equalsVertex);

                return (
                  <Vertex
                    key={`${x}-${y}`}
                    position={[x, y]}
                    shift={fuzzyStonePlacement ? shiftMap?.[y]?.[x] : 0}
                    random={randomMap?.[y]?.[x]}
                    sign={signMap?.[y]?.[x]}
                    heat={heatMap?.[y]?.[x]}
                    marker={markerMap?.[y]?.[x]}
                    ghostStone={ghostStoneMap?.[y]?.[x]}
                    dimmed={dimmedVertices.some(equalsVertex)}
                    animate={animatedVertices.some(equalsVertex)}
                    paint={paintMap?.[y]?.[x]}
                    paintLeft={paintMap?.[y]?.[x - 1]}
                    paintRight={paintMap?.[y]?.[x + 1]}
                    paintTop={paintMap?.[y - 1]?.[x]}
                    paintBottom={paintMap?.[y + 1]?.[x]}
                    paintTopLeft={paintMap?.[y - 1]?.[x - 1]}
                    paintTopRight={paintMap?.[y - 1]?.[x + 1]}
                    paintBottomLeft={paintMap?.[y + 1]?.[x - 1]}
                    paintBottomRight={paintMap?.[y + 1]?.[x + 1]}
                    selected={isSelected}
                    selectedLeft={
                      isSelected &&
                      selectedVertices.some((v) =>
                        vertexEquals(v, [x - 1, y]),
                      )
                    }
                    selectedRight={
                      isSelected &&
                      selectedVertices.some((v) =>
                        vertexEquals(v, [x + 1, y]),
                      )
                    }
                    selectedTop={
                      isSelected &&
                      selectedVertices.some((v) =>
                        vertexEquals(v, [x, y - 1]),
                      )
                    }
                    selectedBottom={
                      isSelected &&
                      selectedVertices.some((v) =>
                        vertexEquals(v, [x, y + 1]),
                      )
                    }
                    onClick={this.props.onVertexClick}
                  />
                );
              }),
            )}
          </div>

          <svg
            className="shudan-lines"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              pointerEvents: "none",
              zIndex: 2,
            }}
          >
            <g
              transform={`translate(-${rangeX[0] * vertexSize} -${rangeY[0] * vertexSize})`}
            >
              {lines.map(({ v1, v2, type }, i) => (
                <Line
                  key={i}
                  v1={v1}
                  v2={v2}
                  type={type}
                  vertexSize={vertexSize}
                />
              ))}
            </g>
          </svg>
        </div>

        {showCoordinates && (
          <CoordY
            height={height}
            ys={ys}
            style={{ gridRow: "2", gridColumn: "3" }}
            coordY={coordY}
          />
        )}
        {showCoordinates && (
          <CoordX
            xs={xs}
            style={{ gridRow: "3", gridColumn: "2" }}
            coordX={coordX}
          />
        )}
      </div>
    );
  }
}
