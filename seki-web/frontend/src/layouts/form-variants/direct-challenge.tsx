// Direct challenge variant.
// Rated: derived settings (handicap/komi/color) shown as read-only preview.
// Unrated: settings editable; derived settings still previewed when opponent selected.

import type { RankData } from "../../game/types";
import { BoardSettingsFields } from "./board-parameters";
import {
  inferSettingsFromRanks,
  rankedSettingsFromGap,
} from "./direct-challenge/ranked-settings";
import {
  AllowUndoField,
  PrivateSpectatorsField,
  SettingsFieldset,
  type GameSettingsSetter,
} from "./shared";

export { inferSettingsFromRanks, rankedSettingsFromGap };

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
  currentUserRank?: RankData | null;
  opponentRank?: RankData | null;
};

export function DirectChallengeForm({
  s,
  set,
  currentUserRank,
  opponentRank,
}: Props) {
  const derived = inferSettingsFromRanks(currentUserRank, opponentRank);
  const handicapValue = s.ranked ? (derived?.handicap ?? 0) : s.handicap;
  const komiValue = s.ranked ? (derived?.komi ?? 6.5) : s.komi;
  const colorValue = s.ranked ? (derived?.color ?? "") : s.color;

  return (
    <SettingsFieldset>
      {s.selectedOpponent && derived && (
        <div class="form-help" style="margin-bottom: 0.5em">
          {derived.handicap >= 2
            ? `Rating gap ~${derived.handicap} stones — you play ${derived.color === "black" ? "Black" : derived.color === "white" ? "White" : "Random"} with ${derived.handicap}-stone handicap and ${derived.komi} komi.`
            : `Rating gap <2 stones — even game, ${derived.komi} komi. You play ${derived.color === "nigiri" ? "Random" : derived.color === "black" ? "Black" : "White"}.`}
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
