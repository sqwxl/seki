import type { ComponentChildren, Ref } from "preact";

export type GameBoardDisplayProps = {
  gobanRef: Ref<HTMLDivElement>;
  cols: number;
  rows: number;
  gobanClass?: string;
  status?: ComponentChildren;
  topPanel?: ComponentChildren;
  bottomPanel?: ComponentChildren;
  controls?: ComponentChildren;
  hideControls?: boolean;
};

export function GameBoardDisplay(props: GameBoardDisplayProps) {
  const gobanClass = ["goban-container", props.gobanClass]
    .filter(Boolean)
    .join(" ");

  return (
    <div class="game-board-column">
      {props.status && <div class="game-status-slot">{props.status}</div>}
      <div class="board-main">
        {props.topPanel && (
          <div class="player-panel player-top">{props.topPanel}</div>
        )}
        <div class="game-board-area">
          <div
            class={gobanClass}
            style={`aspect-ratio: ${props.cols}/${props.rows}`}
            ref={props.gobanRef}
          />
        </div>
        {props.bottomPanel && (
          <div class="player-panel player-bottom">{props.bottomPanel}</div>
        )}
      </div>
      {!props.hideControls && props.controls && (
        <div class="controls">{props.controls}</div>
      )}
    </div>
  );
}
