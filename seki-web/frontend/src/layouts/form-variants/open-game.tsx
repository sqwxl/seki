// Open game variant.
// Three modes:
// - rated: handicap/komi/color derived from ratings at join; game affects ratings.
// - rank-based unrated: same derivation, no rating impact.
// - custom unrated: creator pre-selects handicap/komi/color, used as initial proposal at join.

import { IconBalance } from "../../components/icons";
import { BoardSettingsFields } from "./board-parameters";
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
  customSettings: boolean;
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
  customSettings: false,
};

type Props = {
  s: OpenGameSettings;
  set: GameSettingsSetter<OpenGameSettings>;
  isRegistered?: boolean;
  rankedUnavailableReason?: string | null;
  currentRatingText: string;
};

function OpenGameModeField({
  s,
  set,
  ratedDisabled,
  help,
}: {
  s: OpenGameSettings;
  set: GameSettingsSetter<OpenGameSettings>;
  ratedDisabled?: boolean;
  help?: string;
}) {
  const mode = s.ranked ? "rated" : s.customSettings ? "custom" : "rank";

  function selectMode(next: "rated" | "rank" | "custom") {
    set("ranked", next === "rated");
    set("customSettings", next === "custom");
  }

  return (
    <div>
      <label>
        <IconBalance /> Game type
      </label>
      <input type="hidden" name="ranked" value={s.ranked ? "true" : "false"} />
      <div class="opponent-mode-radios">
        <label>
          <input
            type="radio"
            name="_open_mode"
            checked={mode === "rated"}
            disabled={ratedDisabled}
            onChange={() => selectMode("rated")}
          />
          Rated
        </label>
        <label>
          <input
            type="radio"
            name="_open_mode"
            checked={mode === "rank"}
            onChange={() => selectMode("rank")}
          />
          Unrated — settings from rank
        </label>
        <label>
          <input
            type="radio"
            name="_open_mode"
            checked={mode === "custom"}
            onChange={() => selectMode("custom")}
          />
          Unrated — custom settings
        </label>
      </div>
      {help && <span class="form-help">{help}</span>}
    </div>
  );
}

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
      <OpenGameModeField
        s={s}
        set={set}
        ratedDisabled={!isRegistered || Boolean(rankedBlockedReason)}
        help={
          rankedBlockedReason
            ? rankedBlockedReason
            : currentRatingText
              ? `Your current rating is ${currentRatingText}.`
              : "Your first ranked game starts from a provisional rating."
        }
      />
      {s.customSettings && !s.ranked ? (
        <BoardSettingsFields s={s} set={set} />
      ) : (
        <BoardSizeField s={s} set={set} />
      )}
      <MaxRatingDifferenceField s={s} set={set} />

      <AllowUndoField s={s} set={set} />

      <PrivateSpectatorsField s={s} set={set} locked={s.ranked} />
    </SettingsFieldset>
  );
}
