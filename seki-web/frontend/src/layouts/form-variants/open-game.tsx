// Open game variant.
// Open games defer handicap/komi/color until an opponent joins.

import {
  AllowUndoField,
  BoardSizeField,
  MaxRatingDifferenceField,
  PrivateSpectatorsField,
  RankedGameField,
  SettingsFieldset,
  type GameSettingsSetter,
} from "./shared";

export type OpenGameSettings = {
  cols: number;
  handicap: number;
  komi: number;
  color: string;
  maxRatingDifference: number;
  allowUndo: boolean;
  isPrivate: boolean;
  ranked: boolean;
};

export const OPEN_DEFAULTS: OpenGameSettings = {
  cols: 19,
  handicap: 0,
  komi: 6.5,
  color: "black",
  maxRatingDifference: 40,
  allowUndo: false,
  isPrivate: false,
  ranked: false,
};

type Props = {
  s: OpenGameSettings;
  set: GameSettingsSetter<OpenGameSettings>;
  isRegistered?: boolean;
  rankedUnavailableReason?: string | null;
  currentRatingText: string;
};

export function OpenGameForm({
  s,
  set,
  isRegistered,
  rankedUnavailableReason,
  currentRatingText,
}: Props) {
  const rankedBlockedReason = !isRegistered
    ? (rankedUnavailableReason ?? "Register or sign in to create ranked games.")
    : (rankedUnavailableReason ??
      (s.isPrivate ? "Ranked games must be public." : undefined));

  return (
    <SettingsFieldset>
      <RankedGameField
        s={s}
        set={set}
        disabled={!isRegistered || Boolean(rankedBlockedReason)}
        help={
          rankedBlockedReason
            ? rankedBlockedReason
            : currentRatingText
              ? `Your current rating is ${currentRatingText}.`
              : "Your first ranked game starts from a provisional rating."
        }
      />
      <BoardSizeField s={s} set={set} />
      <MaxRatingDifferenceField s={s} set={set} />

      <AllowUndoField s={s} set={set} />

      <PrivateSpectatorsField s={s} set={set} locked={s.ranked} />
    </SettingsFieldset>
  );
}
