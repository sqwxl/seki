// Extracted from direct-challenge.tsx: ranked settings derivation and board parameter form fields

import type { RankData } from "../../../game/types";
import type { ChallengeSettings } from "../direct-challenge";
import {
  BoardSizeField,
  ColorPickerField,
  ColorPreviewField,
  HandicapSelectField,
  KomiField,
  type GameSettingsSetter,
} from "../shared";

export function rankedSettingsFromGap(
  blackRating: number,
  whiteRating: number,
): { handicap: number; komi: number; color: string } {
  const rps = 100;
  const gap = Math.abs(blackRating - whiteRating);
  const steps = Math.floor(gap / rps);
  const handicap = steps >= 2 ? Math.min(steps, 9) : 0;
  const komi = handicap >= 2 ? 0.5 : 6.5;

  if (Math.abs(blackRating - whiteRating) < 0.01) {
    return { handicap, komi, color: "nigiri" };
  }

  return {
    handicap,
    komi,
    color: blackRating < whiteRating ? "black" : "white",
  };
}

export function inferSettingsFromRanks(
  currentUserRank: RankData | undefined | null,
  opponentRank: RankData | undefined | null,
): { handicap: number; komi: number; color: string } | null {
  if (currentUserRank?.rating == null || opponentRank?.rating == null) {
    return null;
  }

  return rankedSettingsFromGap(currentUserRank.rating, opponentRank.rating);
}

export type Setter = GameSettingsSetter<ChallengeSettings>;

export function BoardParameterFields({
  s,
  set,
  derived,
}: {
  s: ChallengeSettings;
  set: Setter;
  derived: { handicap: number; komi: number; color: string } | null;
}) {
  const showHandicap = s.ranked ? (derived?.handicap ?? 0) : s.handicap;
  const showKomi = s.ranked ? (derived?.komi ?? 6.5) : s.komi;
  const showColor = s.ranked ? (derived?.color ?? "black") : s.color;

  return (
    <>
      <BoardSizeField s={s} set={set} locked={s.ranked} />
      <HandicapSelectField
        s={s}
        set={set}
        max={9}
        value={showHandicap}
        disabled={s.ranked}
      />
      <KomiField value={showKomi} set={set} disabled={s.ranked} />

      {s.ranked ? (
        <ColorPreviewField
          color={showColor}
          help={
            derived
              ? ` (${derived.color === "nigiri" ? "equal rating" : derived.color === "black" ? "lower rating" : "higher rating"})`
              : undefined
          }
        />
      ) : (
        <ColorPickerField s={s} set={set} />
      )}
    </>
  );
}
