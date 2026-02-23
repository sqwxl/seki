import { CapturesBlack, CapturesWhite, IconAsterisk } from "./icons";
import { UserLabel } from "./user-label";

export type PlayerPanelProps = {
  name: string;
  captures: string;
  stone: "black" | "white";
  clock?: string;
  clockLowTime?: boolean;
  profileUrl?: string;
  isOnline?: boolean;
  isTurn?: boolean;
};

export function PlayerPanel(props: PlayerPanelProps) {
  const CapturesIcon = props.stone === "black" ? CapturesBlack : CapturesWhite;

  return (
    <>
      <span class="player-name-group">
        <span class={`turn-indicator${props.isTurn ? " active" : ""}`}>
          <IconAsterisk />
        </span>
        <UserLabel
          name={props.name}
          stone={props.stone}
          profileUrl={props.profileUrl}
          isOnline={props.isOnline}
        />
      </span>
      <span class="player-info">
        <span class="captures-icon">
          <CapturesIcon />
        </span>
        <span class="player-captures">{props.captures}</span>
        <span class={`player-clock${props.clockLowTime ? " low-time" : ""}`}>
          {props.clock ?? ""}
        </span>
      </span>
    </>
  );
}
