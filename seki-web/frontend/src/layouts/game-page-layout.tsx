import type { ComponentChildren, Ref } from "preact";
import { PlayerPanel } from "../components/player-panel";
import type { PlayerPanelProps } from "../components/player-panel";
import { Controls } from "../components/controls";
import type { ControlsProps } from "../components/controls";

export type GamePageLayoutProps = {
  header?: ComponentChildren;
  gobanRef: Ref<HTMLDivElement>;
  gobanStyle?: string;
  gobanClass?: string;
  playerTop?: PlayerPanelProps;
  playerBottom?: PlayerPanelProps;
  controls?: ControlsProps;
  sidebar?: ComponentChildren;
  extra?: ComponentChildren;
};

export function GamePageLayout(props: GamePageLayoutProps) {
  const gobanClass = ["goban-container", props.gobanClass]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      {props.header && <div class="game-header">{props.header}</div>}
      <div class="game-board-area">
        {props.playerTop && (
          <div class="player-label">
            <PlayerPanel {...props.playerTop} />
          </div>
        )}
        <div class={gobanClass} style={props.gobanStyle} ref={props.gobanRef} />
        {props.playerBottom && (
          <div class="player-label">
            <PlayerPanel {...props.playerBottom} />
          </div>
        )}
        {props.controls && (
          <div class="controls">
            <Controls {...props.controls} />
          </div>
        )}
      </div>
      {props.sidebar}
      {props.extra}
    </>
  );
}
