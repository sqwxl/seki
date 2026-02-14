import type { CSSProperties, JSX } from "preact";
import { useCallback } from "preact/hooks";
import classnames from "classnames";
import type {
  MarkerData,
  HeatData,
  GhostStoneData,
  Point,
  VertexEventHandler,
} from "./types";
import { avg, signEquals } from "./helper";
import Marker from "./marker";

interface VertexProps {
  position: Point;
  shift?: number;
  random?: number;
  sign?: number;
  heat?: HeatData | null;
  paint?: number | null;
  paintLeft?: number | null;
  paintRight?: number | null;
  paintTop?: number | null;
  paintBottom?: number | null;
  paintTopLeft?: number | null;
  paintTopRight?: number | null;
  paintBottomLeft?: number | null;
  paintBottomRight?: number | null;
  dimmed?: boolean;
  marker?: MarkerData | null;
  ghostStone?: GhostStoneData | null;
  animate?: boolean;
  selected?: boolean;
  selectedLeft?: boolean;
  selectedRight?: boolean;
  selectedTop?: boolean;
  selectedBottom?: boolean;
  onClick?: VertexEventHandler;
}

const absoluteStyle = (zIndex?: number): CSSProperties => ({
  position: "absolute",
  zIndex,
});

export default function Vertex(props: VertexProps): JSX.Element {
  const {
    position,
    shift,
    random,
    sign,
    heat,
    paint,
    paintLeft,
    paintRight,
    paintTop,
    paintBottom,
    paintTopLeft,
    paintTopRight,
    paintBottomLeft,
    paintBottomRight,
    dimmed,
    marker,
    ghostStone,
    animate,
    selected,
    selectedLeft,
    selectedRight,
    selectedTop,
    selectedBottom,
  } = props;

  const handleClick = useCallback(
    (evt: Event) => {
      props.onClick?.(evt, position);
    },
    [position[0], position[1], props.onClick],
  );

  const markerMarkup = (zIndex?: number) =>
    !!marker && (
      <Marker
        sign={sign ?? 0}
        type={marker.type}
        label={marker.label}
        zIndex={zIndex}
      />
    );

  const hasPaintNeighbor =
    !!paint || !!paintLeft || !!paintRight || !!paintTop || !!paintBottom;

  const paintOpacityValues = paint
    ? [Math.abs(paint) * 0.5]
    : [paintLeft, paintRight, paintTop, paintBottom].map((x) =>
        x != null && x !== 0 && !isNaN(x) ? 0.5 : 0,
      );

  return (
    <div
      data-x={position[0]}
      data-y={position[1]}
      title={marker?.label}
      style={{ position: "relative" } as CSSProperties}
      className={classnames(
        "goban-vertex",
        `goban-random_${random}`,
        `goban-sign_${sign}`,
        {
          [`goban-shift_${shift}`]: !!shift,
          [`goban-heat_${!!heat && heat.strength}`]: !!heat,
          "goban-dimmed": dimmed,
          "goban-animate": animate,

          [`goban-paint_${(paint ?? 0) > 0 ? 1 : -1}`]: !!paint,
          "goban-paintedleft": !!paint && signEquals(paintLeft, paint),
          "goban-paintedright": !!paint && signEquals(paintRight, paint),
          "goban-paintedtop": !!paint && signEquals(paintTop, paint),
          "goban-paintedbottom": !!paint && signEquals(paintBottom, paint),

          "goban-selected": selected,
          "goban-selectedleft": selectedLeft,
          "goban-selectedright": selectedRight,
          "goban-selectedtop": selectedTop,
          "goban-selectedbottom": selectedBottom,

          [`goban-marker_${marker?.type}`]: !!marker?.type,
          "goban-smalllabel":
            marker?.type === "label" &&
            (marker.label?.includes("\n") || (marker.label?.length ?? 0) >= 3),

          [`goban-ghost_${ghostStone?.sign}`]: !!ghostStone,
          [`goban-ghost_${ghostStone?.type}`]: !!ghostStone?.type,
          "goban-ghost_faint": !!ghostStone?.faint,
        },
      )}
      onClick={handleClick}
    >
      {!sign && markerMarkup(0)}
      {!sign && !!ghostStone && (
        <div className="goban-ghost" style={absoluteStyle(1)} />
      )}

      <div className="goban-stone" style={absoluteStyle(2)}>
        {!!sign && (
          <div
            className={classnames(
              "goban-inner",
              "goban-stone-image",
              `goban-random_${random}`,
              `goban-sign_${sign}`,
            )}
            style={absoluteStyle()}
          >
            {sign}
          </div>
        )}
        {!!sign && markerMarkup()}
      </div>

      {hasPaintNeighbor && (
        <div
          className="goban-paint"
          style={
            {
              ...absoluteStyle(3),
              "--goban-paint-opacity": String(avg(paintOpacityValues)),
              "--goban-paint-box-shadow": [
                signEquals(paintLeft, paintTop, paintTopLeft)
                  ? [Math.sign(paintTop ?? 0), "-.5em -.5em"]
                  : null,
                signEquals(paintRight, paintTop, paintTopRight)
                  ? [Math.sign(paintTop ?? 0), ".5em -.5em"]
                  : null,
                signEquals(paintLeft, paintBottom, paintBottomLeft)
                  ? [Math.sign(paintBottom ?? 0), "-.5em .5em"]
                  : null,
                signEquals(paintRight, paintBottom, paintBottomRight)
                  ? [Math.sign(paintBottom ?? 0), ".5em .5em"]
                  : null,
              ]
                .filter((x): x is [number, string] => !!x && x[0] !== 0)
                .map(
                  ([s, translation]) =>
                    `${translation} 0 0 var(${
                      s > 0
                        ? "--goban-black-background-color"
                        : "--goban-white-background-color"
                    })`,
                )
                .join(","),
            } as CSSProperties
          }
        />
      )}

      {!!selected && (
        <div className="goban-selection" style={absoluteStyle(4)} />
      )}

      <div className="goban-heat" style={absoluteStyle(5)} />
      {heat?.text != null && (
        <div className="goban-heatlabel" style={absoluteStyle(6)}>
          {heat.text.toString()}
        </div>
      )}
    </div>
  );
}
