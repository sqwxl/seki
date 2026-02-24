import type { JSX } from "preact";

type MarkerProps = {
  sign: number;
  type: string;
  label?: string;
  zIndex?: number;
};

export default function Marker({
  sign,
  type,
  label,
  zIndex,
}: MarkerProps): JSX.Element {
  const containerStyle: JSX.CSSProperties = {
    position: "absolute",
    zIndex,
  };

  if (type === "label") {
    return (
      <div className="goban-marker" style={containerStyle}>
        {label}
      </div>
    );
  }

  return (
    <svg className="goban-marker" style={containerStyle} viewBox="0 0 1 1">
      {(type === "circle" || type === "loader" || type === "point") && (
        <circle
          cx={0.5}
          cy={0.5}
          r={type === "point" ? 0.18 : 0.25}
          vector-effect="non-scaling-stroke"
        />
      )}
      {type === "square" && (
        <rect
          x={0.25}
          y={0.25}
          width={0.5}
          height={0.5}
          vector-effect="non-scaling-stroke"
        />
      )}
      {type === "cross" && (
        <>
          {sign === 0 && (
            <rect x={0.25} y={0.25} width={0.5} height={0.5} stroke="none" />
          )}
          <path
            d="M 0 0 L .5 .5 M .5 0 L 0 .5"
            transform="translate(.25 .25)"
            vector-effect="non-scaling-stroke"
          />
        </>
      )}
      {type === "triangle" && (
        <path
          d="M 0 .5 L .6 .5 L .3 0 z"
          transform="translate(.2 .2)"
          vector-effect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
