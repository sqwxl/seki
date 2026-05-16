import { formatN } from "../utils/format";
import { CapturesBlack, CapturesWhite, IconGrid3x3 } from "./icons";
import { UserLabel } from "./user-label";
import type { RankData } from "../game/types";
import { primaryRankText, parseRatingDisplayMode } from "../utils/rating";
import { readUserData } from "../game/util";

export type PlayerPanelProps = {
  name: string;
  captures: number;
  komi?: number;
  territory?: number;
  stone: "black" | "white" | "nigiri";
  clock?: string;
  clockLowTime?: boolean;
  profileUrl?: string;
  isOnline?: boolean;
  rank?: RankData | null;
};

export function PlayerPanel(props: PlayerPanelProps) {
  const mode = parseRatingDisplayMode(readUserData()?.preferences.rating_display);
  const rankText = props.rank ? primaryRankText(props.rank, mode) : undefined;

  return (
    <>
      <span class="player-name-group">
        <UserLabel
          name={props.name}
          stone={props.stone}
          profileUrl={props.profileUrl}
          isOnline={props.isOnline}
        />
        {rankText && <span class="player-rank">{rankText}</span>}
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
