import { CapturesBlack, CapturesWhite } from "./icons";
import { UserLabel } from "./user-label";

export type PlayerPanelProps = {
  name: string;
  captures: string;
  stone: "black" | "white" | "nigiri";
  clock?: string;
  clockLowTime?: boolean;
  profileUrl?: string;
  isOnline?: boolean;
};

export function PlayerPanel(props: PlayerPanelProps) {
  return (
    <>
      <span class="player-name-group">
        <UserLabel
          name={props.name}
          stone={props.stone}
          profileUrl={props.profileUrl}
          isOnline={props.isOnline}
        />
      </span>
      <span class={`player-clock${props.clockLowTime ? " low-time" : ""}`}>
        {props.clock ?? ""}
      </span>
      <span class="player-captures">
        {props.stone !== "nigiri" && (
          <>
            {props.captures}
            <span class="captures-icon">
              {props.stone === "black" ? <CapturesBlack /> : <CapturesWhite />}
            </span>
          </>
        )}
      </span>
    </>
  );
}
