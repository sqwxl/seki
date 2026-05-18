// Open game variant.
// Open games defer handicap/komi/color until an opponent joins.

import {
  AllowUndoField,
  BoardSizeField,
  MaxRatingDifferenceField,
  PrivateSpectatorsField,
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
};

export function OpenGameForm({ s, set }: Props) {
  return (
    <SettingsFieldset>
      <BoardSizeField s={s} set={set} />
      <MaxRatingDifferenceField s={s} set={set} />

      <AllowUndoField s={s} set={set} />

      <PrivateSpectatorsField s={s} set={set} locked={s.ranked} />
    </SettingsFieldset>
  );
}
