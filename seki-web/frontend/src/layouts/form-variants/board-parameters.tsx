import {
  BoardSizeField,
  ColorPickerField,
  HandicapSelectField,
  KomiField,
  type BaseGameSettings,
  type GameSettingsSetter,
} from "./shared";

export type DerivedBoardParameters = {
  handicap: number;
  komi: number;
  color: string;
};

export function BoardSettingsFields<T extends BaseGameSettings>({
  s,
  set,
  colorLabel,
  handicapValue = s.handicap,
  komiValue = s.komi,
  colorValue = s.color,
  handicapDisabled,
  komiDisabled,
  colorLocked,
  boardLocked,
}: {
  s: T;
  set: GameSettingsSetter<T>;
  colorLabel?: string;
  handicapValue?: number;
  komiValue?: number;
  colorValue?: string;
  handicapDisabled?: boolean;
  komiDisabled?: boolean;
  colorLocked?: boolean;
  boardLocked?: boolean;
}) {
  return (
    <>
      <ColorPickerField
        s={s}
        set={set}
        label={colorLabel}
        value={colorValue}
        disabled={colorLocked}
      />
      <BoardSizeField s={s} set={set} locked={boardLocked} />
      <HandicapSelectField
        s={s}
        set={set}
        value={handicapValue}
        disabled={handicapDisabled}
      />
      <KomiField value={komiValue} set={set} disabled={komiDisabled} />
    </>
  );
}
