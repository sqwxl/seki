import { render } from "preact";
import {
  StoneBlack, StoneWhite,
  CapturesBlack, CapturesWhite,
  IconAsterisk,
} from "./icons";

export type PlayerLabelProps = {
  name: string;
  captures: string;
  stone: "black" | "white";
  clock?: string;
  clockLowTime?: boolean;
  profileUrl?: string;
  isOnline?: boolean;
  isTurn?: boolean;
};

function PlayerLabel(props: PlayerLabelProps) {
  const StoneIcon = props.stone === "black" ? StoneBlack : StoneWhite;
  const CapturesIcon = props.stone === "black" ? CapturesBlack : CapturesWhite;

  return (
    <>
      <span class="player-name-group">
        <span class={`turn-indicator${props.isTurn ? " active" : ""}`}>
          <IconAsterisk />
        </span>
        <span class="stone-icon"><StoneIcon /></span>
        <span class="player-name">
          {props.profileUrl
            ? <a href={props.profileUrl}>{props.name}</a>
            : props.name}
        </span>
        {props.isOnline !== undefined && (
          <span class={`presence-dot${props.isOnline ? " online" : ""}`} />
        )}
      </span>
      <span class="player-info">
        <span class="captures-icon"><CapturesIcon /></span>
        <span class="player-captures">{props.captures}</span>
        <span class={`player-clock${props.clockLowTime ? " low-time" : ""}`}>
          {props.clock ?? ""}
        </span>
      </span>
    </>
  );
}

export function renderPlayerLabel(el: HTMLElement, props: PlayerLabelProps): void {
  render(<PlayerLabel {...props} />, el);
}
