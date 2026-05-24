import type { RankData, UserData } from "../game/types";
import { formatN } from "../utils/format";
import { CapturesBlack, CapturesWhite, IconGrid3x3 } from "./icons";
import { UserLabel } from "./user-label";

export type PlayerPanelProps = {
  userData?: UserData;
  captures: number;
  komi?: number;
  territory?: number;
  stone: "black" | "white" | "nigiri";
  clock?: string;
  clockLowTime?: boolean;
  isOnline?: boolean;
  strong?: boolean;
  rank?: RankData | null;
};

export function PlayerPanel(props: PlayerPanelProps) {
  return (
    <>
      <span class="player-name-group">
        {props.userData ? (
          <UserLabel
            user={props.userData}
            options={{
              stone: props.stone,
              showPresence: props.isOnline !== undefined,
              presence: props.isOnline,
              strong: props.strong,
              rank: { value: props.rank },
            }}
          />
        ) : (
          <span class="user-label">...</span>
        )}
      </span>
      <span class={`player-clock${props.clockLowTime ? " low-time" : ""}`}>
        {props.clock ?? ""}
      </span>
      <span class="player-captures">
        {props.stone !== "nigiri" && (
          <>
            {props.territory != null && (
              <>
                {props.territory}
                <span class="territory-icon">
                  <IconGrid3x3 title="Territory" />
                </span>
              </>
            )}
            {formatN(props.captures)}
            {props.komi ? `+${formatN(props.komi)}` : ""}
            <span class="captures-icon">
              {props.stone === "black" ? (
                <CapturesBlack title="Captures" />
              ) : (
                <CapturesWhite title="Captures" />
              )}
            </span>
          </>
        )}
      </span>
    </>
  );
}
