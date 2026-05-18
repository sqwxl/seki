import type { ComponentChildren } from "preact";
import { HandicapSelect } from "../../components/controls-shared";
import {
  IconBalance,
  IconGrid4x4,
  IconKomi,
  IconNigiri,
  IconPlus,
  IconPrivate,
  IconSettings,
  IconUndo,
  StoneBlack,
  StoneWhite,
} from "../../components/icons";
import { getWasm } from "../../goban/init-wasm";
export { OpponentSelect, type OpponentSearchResult } from "./opponent-select";

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
  hidden?: boolean;
  help?: string;
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
        <IconSettings /> Settings
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
    <div title={help}>
      <label for={id}>
        <IconBalance /> Rated?
        <input
          type="checkbox"
          name="ranked"
          id={id}
          value="true"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange?.(e.currentTarget.checked)}
        />
      </label>
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
      {/*
        Keep the select on one of the supported board sizes so older saved
        values don't leave the control in an invalid state.
      */}
      <select
        name="cols"
        id="cols"
        value={locked ? 19 : normalizeBoardSize(s.cols)}
        disabled={locked}
        onChange={(e) => set("cols", parseInt(e.currentTarget.value, 10) || 19)}
      >
        <option value={19}>19x19</option>
        <option value={13}>13x13</option>
        <option value={9}>9x9</option>
      </select>
      {locked && <input type="hidden" name="cols" value={19} />}
    </div>
  );
}

function normalizeBoardSize(size: number): 19 | 13 | 9 {
  if (size === 13 || size === 9) {
    return size;
  }

  return 19;
}

export function HandicapSelectField<T extends BaseGameSettings>({
  s,
  set,
  max = getWasm().max_handicap_for_board(s.cols, s.cols),
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
        <IconPlus /> Handicap
      </label>
      <HandicapSelect
        value={value}
        max={max}
        disabled={disabled}
        onChange={(handicap) => {
          set("handicap", handicap);
          if (handicap >= 2) {
            set("komi", 0.5 as T["komi"]);
          }
        }}
      />
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
  value = s.color,
  disabled,
}: {
  s: T;
  set: GameSettingsSetter<T>;
  label?: string;
  value?: string;
  disabled?: boolean;
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
          checked={value === "black"}
          disabled={disabled}
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
          checked={value === "white"}
          disabled={disabled}
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
          checked={value === "nigiri"}
          disabled={disabled}
          onChange={() => set("color", "nigiri" as T["color"])}
        />
        <label for="color_nigiri" title="Random">
          <IconNigiri />
        </label>
      </div>
      {disabled && value && <input type="hidden" name="color" value={value} />}
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

export function MaxRatingDifferenceField<
  T extends BaseGameSettings & { maxRatingDifference: number },
>({ s, set }: { s: T; set: GameSettingsSetter<T> }) {
  return (
    <div>
      <label for="max_rating_difference">
        <IconPlus /> Max rating difference
      </label>
      <input
        type="range"
        id="max_rating_difference"
        min={0}
        max={40}
        step={1}
        value={s.maxRatingDifference}
        onInput={(e) =>
          set(
            "maxRatingDifference",
            parseInt(e.currentTarget.value, 10) as T["maxRatingDifference"],
          )
        }
      />
      <input
        type="hidden"
        name="rating_range_mode"
        value={s.maxRatingDifference >= 40 ? "unlimited" : "absolute"}
      />
      {s.maxRatingDifference < 40 && (
        <input
          type="hidden"
          name="max_rating_difference"
          value={s.maxRatingDifference}
        />
      )}
      <span class="form-help">
        {s.maxRatingDifference >= 40
          ? "Unlimited"
          : `${s.maxRatingDifference} rank steps`}
      </span>
    </div>
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
        <IconUndo /> Allow undo
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
      </label>
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
  if (locked) {
    return <input type="hidden" name="is_private" value="false" />;
  }

  return (
    <div title="Hide this game from public lists. Non-participants will need an invite link to view it.">
      <label for="is_private">
        <IconPrivate /> Private
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
      </label>
    </div>
  );
}
