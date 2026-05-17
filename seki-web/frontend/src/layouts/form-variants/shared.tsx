import type { ComponentChildren } from "preact";
import {
  IconBell,
  IconGrid4x4,
  IconHandicap,
  IconKomi,
  IconNigiri,
  IconPrivate,
  IconSettings,
  IconUndo,
  StoneBlack,
  StoneWhite,
} from "../../components/icons";

export type BaseGameSettings = {
  cols: number;
  handicap: number;
  komi: number;
  color: string;
  allowUndo: boolean;
  isPrivate: boolean;
};

export type GameSettingsSetter<T extends BaseGameSettings> = <
  K extends keyof T,
>(
  key: K,
  value: T[K],
) => void;

type RankedGameFieldProps = {
  id: string;
  checked: boolean;
  disabled?: boolean;
  help: string | undefined;
  onChange?: (checked: boolean) => void;
};

export function SettingsFieldset({
  children,
}: {
  children: ComponentChildren;
}) {
  return (
    <fieldset>
      <legend>
        <IconSettings />
        Settings
      </legend>
      {children}
    </fieldset>
  );
}

export function RankedGameField({
  id,
  checked,
  disabled,
  help,
  onChange,
}: RankedGameFieldProps) {
  return (
    <div>
      <label for={id}>
        <IconBell /> Ranked game
      </label>
      <input
        type="checkbox"
        name="ranked"
        id={id}
        value="true"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.currentTarget.checked)}
      />
      {help && <p class="form-help">{help}</p>}
    </div>
  );
}

export function BoardSizeField<T extends BaseGameSettings>({
  s,
  set,
  locked,
}: {
  s: T;
  set: GameSettingsSetter<T>;
  locked?: boolean;
}) {
  return (
    <div>
      <label for="cols">
        <IconGrid4x4 /> Board size
      </label>
      <input
        type="number"
        name="cols"
        id="cols"
        min={5}
        max={19}
        step={2}
        value={locked ? 19 : s.cols}
        disabled={locked}
        onChange={(e) => set("cols", parseInt(e.currentTarget.value, 10) || 19)}
      />
      {locked && <input type="hidden" name="cols" value={19} />}
    </div>
  );
}

export function maxHandicapForBoard(size: number): number {
  if (size % 2 === 0 || size < 7) {
    return 0;
  }

  return size >= 13 ? 9 : 5;
}

export function HandicapSelectField<T extends BaseGameSettings>({
  s,
  set,
  max = maxHandicapForBoard(s.cols),
  value = s.handicap,
  disabled,
}: {
  s: T;
  set: GameSettingsSetter<T>;
  max?: number;
  value?: number;
  disabled?: boolean;
}) {
  return (
    <div>
      <label for="handicap">
        <IconHandicap /> Handicap
      </label>
      <select
        name="handicap"
        id="handicap"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const handicap = parseInt(e.currentTarget.value, 10);
          set("handicap", handicap);
          if (handicap >= 2) {
            set("komi", 0.5 as T["komi"]);
          }
        }}
      >
        <option value={0}>None</option>
        {Array.from({ length: Math.max(0, max - 1) }, (_, i) => {
          const v = i + 2;
          return (
            <option key={v} value={v}>
              {v}
            </option>
          );
        })}
      </select>
      {disabled && <input type="hidden" name="handicap" value={value} />}
    </div>
  );
}

export function KomiField<T extends BaseGameSettings>({
  value,
  disabled,
  set,
}: {
  value: number;
  disabled?: boolean;
  set: GameSettingsSetter<T>;
}) {
  return (
    <div>
      <label for="komi">
        <IconKomi /> Komi
      </label>
      <input
        type="number"
        name="komi"
        id="komi"
        min={-100.5}
        max={100.5}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) =>
          set("komi", (parseFloat(e.currentTarget.value) || 0) as T["komi"])
        }
      />
      {disabled && <input type="hidden" name="komi" value={value} />}
    </div>
  );
}

export function ColorPickerField<T extends BaseGameSettings>({
  s,
  set,
  label = "Your color",
}: {
  s: T;
  set: GameSettingsSetter<T>;
  label?: string;
}) {
  return (
    <div>
      <label>{label}</label>
      <div class="color-picker">
        <input
          type="radio"
          name="color"
          value="black"
          id="color_black"
          checked={s.color === "black"}
          onChange={() => set("color", "black" as T["color"])}
        />
        <label for="color_black" title="Black">
          <StoneBlack />
        </label>
        <input
          type="radio"
          name="color"
          value="white"
          id="color_white"
          checked={s.color === "white"}
          onChange={() => set("color", "white" as T["color"])}
        />
        <label for="color_white" title="White">
          <StoneWhite />
        </label>
        <input
          type="radio"
          name="color"
          value="nigiri"
          id="color_nigiri"
          checked={s.color === "nigiri"}
          onChange={() => set("color", "nigiri" as T["color"])}
        />
        <label for="color_nigiri" title="Random">
          <IconNigiri />
        </label>
      </div>
    </div>
  );
}

export function ColorPreviewField({
  color,
  help,
}: {
  color: string;
  help?: string;
}) {
  return (
    <div>
      <label>Your color</label>
      <p class="form-help">
        {color === "black" ? "Black" : color === "white" ? "White" : "Random"}
        {help}
      </p>
      <input type="hidden" name="color" value={color} />
    </div>
  );
}

export function MaxHandicapField<
  T extends BaseGameSettings & { maxHandicap: number },
>({ s, set }: { s: T; set: GameSettingsSetter<T> }) {
  return (
    <div>
      <label for="max_handicap">
        <IconHandicap /> Max handicap
      </label>
      <input
        type="range"
        name="max_handicap"
        id="max_handicap"
        min={0}
        max={9}
        step={1}
        value={s.maxHandicap}
        onChange={(e) =>
          set(
            "maxHandicap",
            parseInt(e.currentTarget.value, 10) as T["maxHandicap"],
          )
        }
      />
      <span class="form-help">Max {s.maxHandicap} stones</span>
    </div>
  );
}

export function EditableBoardSettings<T extends BaseGameSettings>({
  s,
  set,
  colorLabel,
  maxHandicap,
}: {
  s: T;
  set: GameSettingsSetter<T>;
  colorLabel?: string;
  maxHandicap?: number;
}) {
  return (
    <>
      <BoardSizeField s={s} set={set} />
      <HandicapSelectField s={s} set={set} max={maxHandicap} />
      <KomiField value={s.komi} set={set} />
      <ColorPickerField s={s} set={set} label={colorLabel} />
    </>
  );
}

export function AllowUndoField<T extends BaseGameSettings>({
  s,
  set,
}: {
  s: T;
  set: GameSettingsSetter<T>;
}) {
  return (
    <div>
      <label for="allow_undo">
        <IconUndo /> Allow takebacks
      </label>
      <input
        type="checkbox"
        name="allow_undo"
        id="allow_undo"
        value="true"
        checked={s.allowUndo}
        onChange={(e) =>
          set("allowUndo", e.currentTarget.checked as T["allowUndo"])
        }
      />
    </div>
  );
}

export function PrivateSpectatorsField<T extends BaseGameSettings>({
  s,
  set,
  locked,
}: {
  s: T;
  set: GameSettingsSetter<T>;
  locked?: boolean;
}) {
  return (
    <div>
      <label for="is_private">
        <IconPrivate /> Private spectators
      </label>
      <input
        type="checkbox"
        name="is_private"
        id="is_private"
        value="true"
        checked={s.isPrivate}
        disabled={locked}
        onChange={(e) =>
          set("isPrivate", e.currentTarget.checked as T["isPrivate"])
        }
      />
      {locked && <input type="hidden" name="is_private" value="false" />}
      <p class="form-help">
        Hide this game from public lists. Non-participants need the invite link
        to view it.
      </p>
    </div>
  );
}
