import type { ComponentChildren, Ref } from "preact";
import { PlayerPanel } from "../components/player-panel";
import type { PlayerPanelProps } from "../components/player-panel";
import type { ControlsProps } from "../components/controls";
import { Controls } from "./controls";

export type GamePageLayoutProps = {
  header?: ComponentChildren;
  gobanRef: Ref<HTMLDivElement>;
  gobanStyle?: string;
  gobanClass?: string;
  playerTop?: PlayerPanelProps;
  playerBottom?: PlayerPanelProps;
  controls?: ControlsProps;
  sidebar?: ComponentChildren;
};

export function GamePageLayout(props: GamePageLayoutProps) {
  const gobanClass = ["goban-container", props.gobanClass]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      {props.header && <div class="game-header">{props.header}</div>}
      {props.playerTop && (
        <div class="player-label player-top">
          <PlayerPanel {...props.playerTop} />
        </div>
      )}
      <div class="game-board-area">
        <div class={gobanClass} style={props.gobanStyle} ref={props.gobanRef} />
      </div>
      {props.sidebar}
      {props.playerBottom && (
        <div class="player-label player-bottom">
          <PlayerPanel {...props.playerBottom} />
        </div>
      )}
      {props.controls && (
        <div class="controls">
          <Controls {...props.controls} />
        </div>
      )}
    </>
  );
}
