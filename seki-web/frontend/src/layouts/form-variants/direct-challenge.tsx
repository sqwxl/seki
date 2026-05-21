// Direct challenge variant.
// Rated: derived settings (handicap/komi) shown as read-only preview.
// Unrated: settings editable; derived settings still previewed when opponent selected.

import type { DerivedHandicapKomi, RankData } from "../../game/types";
import { BoardSettingsFields } from "./board-parameters";
import {
  AllowUndoField,
  PrivateSpectatorsField,
  SettingsFieldset,
  type GameSettingsSetter,
} from "./shared";

export type ChallengeSettings = {
  cols: number;
  handicap: number;
  komi: number;
  color: string;
  allowUndo: boolean;
  isPrivate: boolean;
  ranked: boolean;
  selectedOpponent: string;
};

export const CHALLENGE_DEFAULTS: ChallengeSettings = {
  cols: 19,
  handicap: 0,
  komi: 6.5,
  color: "black",
  allowUndo: false,
  isPrivate: false,
  ranked: false,
  selectedOpponent: "",
};

type Props = {
  s: ChallengeSettings;
  set: GameSettingsSetter<ChallengeSettings>;
  derivedHandicapKomi?: DerivedHandicapKomi | null;
  currentUserRank?: RankData | null;
  opponentRank?: RankData | null;
};

export function DirectChallengeForm({
  s,
  set,
  derivedHandicapKomi,
  currentUserRank,
  opponentRank,
}: Props) {
  const handicapValue = s.ranked
    ? (derivedHandicapKomi?.handicap ?? 0)
    : s.handicap;
  const komiValue = s.ranked ? (derivedHandicapKomi?.komi ?? 6.5) : s.komi;
  const derivedColor =
    !currentUserRank?.rating || !opponentRank?.rating
      ? undefined
      : Math.abs(currentUserRank.rating - opponentRank.rating) < 0.01
        ? "nigiri"
        : currentUserRank.rating < opponentRank.rating
          ? "black"
          : "white";
  const colorValue = s.ranked ? (derivedColor ?? s.color) : s.color;

  return (
    <SettingsFieldset>
      {s.selectedOpponent && derivedHandicapKomi && derivedColor && (
        <div class="form-help" style="margin-bottom: 0.5em">
          {derivedHandicapKomi.handicap >= 2
            ? `Rating gap ~${derivedHandicapKomi.handicap} stones — you play ${derivedColor === "black" ? "Black" : derivedColor === "white" ? "White" : "Random"} with ${derivedHandicapKomi.handicap}-stone handicap and ${derivedHandicapKomi.komi} komi.`
            : `Rating gap <2 stones — even game, ${derivedHandicapKomi.komi} komi. You play ${derivedColor === "nigiri" ? "Random" : derivedColor === "black" ? "Black" : "White"}.`}
        </div>
      )}

      <BoardSettingsFields
        s={s}
        set={set}
        handicapValue={handicapValue}
        komiValue={komiValue}
        colorValue={colorValue}
        handicapDisabled={s.ranked}
        komiDisabled={s.ranked}
        colorLocked={s.ranked}
      />

      <AllowUndoField s={s} set={set} />

      <PrivateSpectatorsField s={s} set={set} locked={s.ranked} />
    </SettingsFieldset>
  );
}
