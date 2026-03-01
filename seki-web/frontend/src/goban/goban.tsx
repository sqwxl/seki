import classnames from "classnames";
import type { CSSProperties, HTMLAttributes, JSX } from "preact";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";

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
  crosshairStone?: number;
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

function initAnimState(
  cols: number,
  rows: number,
  signMap: number[],
): AnimState {
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

  // --- Touch crosshair ---
  const contentRef = useRef<HTMLDivElement>(null);
  const [touchTarget, setTouchTarget] = useState<Point | null>(null);
  const touchTargetRef = useRef<Point | null>(null);
  const onVertexClickRef = useRef(props.onVertexClick);
  onVertexClickRef.current = props.onVertexClick;

  const OFFSET_PX = 76; // ~2cm in CSS pixels (consistent across DPI)

  const touchToVertex = useCallback(
    (touch: Touch): Point | null => {
      const el = contentRef.current;
      if (!el) {
        return null;
      }
      const rect = el.getBoundingClientRect();
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top - OFFSET_PX;
      const vx = rect.width / cols;
      const col = Math.round(x / vx - 0.5);
      const row = Math.round(y / vx - 0.5);
      if (col < 0 || col >= cols || row < 0 || row >= rows) {
        return null;
      }
      return [col, row];
    },
    [cols, rows],
  );

  const isFarFromBoard = useCallback((touch: Touch): boolean => {
    const el = contentRef.current;
    if (!el) {
      return true;
    }
    const rect = el.getBoundingClientRect();
    const margin = 2 * OFFSET_PX;
    return (
      touch.clientX < rect.left - margin ||
      touch.clientX > rect.right + margin ||
      touch.clientY < rect.top - margin ||
      touch.clientY > rect.bottom + margin
    );
  }, []);

  const crosshairActive = !!props.crosshairStone && !!props.onVertexClick;

  useEffect(() => {
    const el = contentRef.current;
    if (!el || !crosshairActive) {
      return;
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) {
        touchTargetRef.current = null;
        setTouchTarget(null);
        return;
      }
      e.preventDefault();
      const pt = touchToVertex(e.touches[0]);
      touchTargetRef.current = pt;
      setTouchTarget(pt);
    }

    function onTouchMove(e: TouchEvent) {
      if (e.touches.length !== 1) {
        touchTargetRef.current = null;
        setTouchTarget(null);
        return;
      }
      e.preventDefault();
      if (isFarFromBoard(e.touches[0])) {
        touchTargetRef.current = null;
        setTouchTarget(null);
        return;
      }
      const pt = touchToVertex(e.touches[0]);
      touchTargetRef.current = pt;
      setTouchTarget(pt);
    }

    function onTouchEnd(e: TouchEvent) {
      e.preventDefault();
      const target = touchTargetRef.current;
      if (target) {
        onVertexClickRef.current?.(e, target);
      }
      touchTargetRef.current = null;
      setTouchTarget(null);
    }

    function onTouchCancel() {
      touchTargetRef.current = null;
      setTouchTarget(null);
    }

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: false });
    el.addEventListener("touchcancel", onTouchCancel);

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [crosshairActive, touchToVertex, isFarFromBoard]);

  // --- Animation state ---

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
    ref.current.animatedVertices = diffSignMap(
      ref.current.prevSignMap,
      signMap,
    );
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
        ref={contentRef}
        className="goban-content"
        style={{
          position: "relative",
          width: `${cols}em`,
          height: `${rows}em`,
          gridRow: showCoordinates ? "2" : "1",
          gridColumn: showCoordinates ? "2" : "1",
          ...(crosshairActive ? { touchAction: "none" } : {}),
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
            const isTouchPreview =
              !!touchTarget &&
              x === touchTarget[0] &&
              y === touchTarget[1] &&
              (signMap[i] ?? 0) === 0;

            return (
              <Vertex
                key={i}
                position={[x, y]}
                shift={fuzzyStonePlacement ? shiftMap?.[i] : 0}
                random={randomMap?.[i]}
                sign={isTouchPreview ? props.crosshairStone : signMap?.[i]}
                heat={heatMap?.[i]}
                marker={markerMap?.[i]}
                ghostStone={ghostStoneMap?.[i]}
                dimmed={isTouchPreview || dimmedVertices.some(equalsVertex)}
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

        {touchTarget && (
          <svg
            className="goban-crosshair"
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              zIndex: 10,
            }}
            viewBox={`-0.5 -0.5 ${cols} ${rows}`}
          >
            <line
              className="goban-crosshair-line"
              x1={0}
              y1={touchTarget[1]}
              x2={cols - 1}
              y2={touchTarget[1]}
            />
            <line
              className="goban-crosshair-line"
              x1={touchTarget[0]}
              y1={0}
              x2={touchTarget[0]}
              y2={rows - 1}
            />
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
