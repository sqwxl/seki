import { StoneBlack, StoneWhite, IconNigiri, IconUser } from "./icons";
import type { RankData } from "../game/types";
import type { RatingDisplayMode } from "../utils/rating";
import { alternateRankText, primaryRankText } from "../utils/rating";
import { readRatingDisplayPreference } from "../utils/preferences";

type UserLabelProps = {
  name: string;
  stone?: "black" | "white" | "nigiri";
  profileUrl?: string;
  isOnline?: boolean;
  showRegistered?: boolean;
  bold?: boolean;
  rank?: RankData | null;
  ratingDisplay?: RatingDisplayMode;
};

function StoneIcon({ stone }: { stone: "black" | "white" | "nigiri" }) {
  if (stone === "nigiri") {
    return <IconNigiri />;
  }
  return stone === "black" ? <StoneBlack /> : <StoneWhite />;
}

export function UserLabel(props: UserLabelProps) {
  const ratingDisplay = props.ratingDisplay ?? readRatingDisplayPreference();
  const rankText = primaryRankText(props.rank, ratingDisplay);
  const alternateRank = alternateRankText(props.rank, ratingDisplay);
  const nameContent = props.profileUrl ? (
    <a href={props.profileUrl}>{props.name}</a>
  ) : (
    props.name
  );

  return (
    <span class={props.bold ? "user-label active-turn" : "user-label"}>
      {props.stone && (
        <span class="stone-icon">
          <StoneIcon stone={props.stone} />
        </span>
      )}
      {props.showRegistered && <IconUser />}
      <span class="player-name">{nameContent}</span>
      {rankText && (
        <span
          class="player-rank"
          title={alternateRank || undefined}
          aria-label={alternateRank ? `${rankText} ${alternateRank}` : rankText}
        >
          {rankText}
        </span>
      )}
      {props.isOnline !== undefined && (
        <span class={`presence-dot${props.isOnline ? " online" : ""}`} />
      )}
    </span>
  );
}
