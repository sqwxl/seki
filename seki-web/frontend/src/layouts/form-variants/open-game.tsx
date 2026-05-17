// Open game variant — supports Rated/Unrated toggle
// Rated: board locked to 19×19, komi/color absent, max handicap slider shown
// Unrated: full settings editable

import type { RankData } from "../../game/types";
import { fullRankText } from "../../utils/rating";
import {
  AllowUndoField,
  BoardSizeField,
  EditableBoardSettings,
  MaxHandicapField,
  PrivateSpectatorsField,
  RankedGameField,
  SettingsFieldset,
  type GameSettingsSetter,
} from "./shared";

export type OpenGameSettings = {
  cols: number;
  handicap: number;
  maxHandicap: number;
  allowUndo: boolean;
  isPrivate: boolean;
  ranked: boolean;
  color: string;
  komi: number;
};

export const OPEN_DEFAULTS: OpenGameSettings = {
  cols: 19,
  handicap: 0,
  maxHandicap: 4,
  allowUndo: false,
  isPrivate: false,
  ranked: false,
  color: "black",
  komi: 6.5,
};

type Props = {
  s: OpenGameSettings;
  set: GameSettingsSetter<OpenGameSettings>;
  isRegistered?: boolean;
  currentUserRank?: RankData | null;
  rankedUnavailableReason?: string | null;
  showPrivate?: boolean;
};

export function OpenGameForm({
  s,
  set,
  isRegistered,
  currentUserRank,
  rankedUnavailableReason,
  showPrivate = true,
}: Props) {
  const currentRatingText = fullRankText(currentUserRank);

  const rankedBlockedReason = !isRegistered
    ? (rankedUnavailableReason ?? "Register or sign in to create ranked games.")
    : (rankedUnavailableReason ??
      (s.isPrivate ? "Ranked games must be public." : undefined));
  const rankedDisabled = Boolean(rankedBlockedReason);

  return (
    <SettingsFieldset>
      <RankedGameField
        id="open_ranked"
        checked={s.ranked}
        onChange={(checked) => set("ranked", checked)}
        disabled={!isRegistered || rankedDisabled}
        help={
          rankedDisabled
            ? rankedBlockedReason
            : currentRatingText
              ? `Your current rating is ${currentRatingText}.`
              : "Your first ranked game starts from a provisional rating."
        }
      />

      {s.ranked ? (
        <>
          <BoardSizeField s={s} set={set} locked />
          <MaxHandicapField s={s} set={set} />
        </>
      ) : (
        <EditableBoardSettings s={s} set={set} />
      )}

      <AllowUndoField s={s} set={set} />

      {showPrivate && (
        <PrivateSpectatorsField s={s} set={set} locked={s.ranked} />
      )}
    </SettingsFieldset>
  );
}
