// Open game variant.
// Rated: board locked to 19×19, komi/color absent, max handicap slider shown
// Unrated: full settings editable

import { BoardSettingsFields } from "./board-parameters";
import {
  AllowUndoField,
  BoardSizeField,
  MaxHandicapField,
  PrivateSpectatorsField,
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
};

export function OpenGameForm({ s, set }: Props) {
  return (
    <SettingsFieldset>
      {s.ranked ? (
        <>
          <BoardSizeField s={s} set={set} locked />
          <MaxHandicapField s={s} set={set} />
        </>
      ) : (
        <BoardSettingsFields s={s} set={set} />
      )}

      <AllowUndoField s={s} set={set} />

      <PrivateSpectatorsField s={s} set={set} locked={s.ranked} />
    </SettingsFieldset>
  );
}
