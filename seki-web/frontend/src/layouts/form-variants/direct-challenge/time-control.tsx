// Extracted from direct-challenge.tsx: ranked settings derivation and board parameter form fields

import {
  IconGrid4x4,
  IconHandicap,
  IconKomi,
  IconNigiri,
  StoneBlack,
  StoneWhite,
} from "../../../components/icons";
import type { RankData } from "../../../game/types";
import type { ChallengeSettings } from "../direct-challenge";

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

export type Setter = <K extends keyof ChallengeSettings>(
  key: K,
  value: ChallengeSettings[K],
) => void;

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
          value={s.ranked ? 19 : s.cols}
          disabled={s.ranked}
          onChange={(e) =>
            set("cols", parseInt(e.currentTarget.value, 10) || 19)
          }
        />
        {s.ranked && <input type="hidden" name="cols" value={19} />}
      </div>

      <div>
        <label for="handicap">
          <IconHandicap /> Handicap
        </label>
        <input
          type="number"
          name="handicap"
          id="handicap"
          value={showHandicap}
          disabled={s.ranked}
          onChange={(e) =>
            set("handicap", parseInt(e.currentTarget.value, 10) || 0)
          }
        />
        {s.ranked && (
          <input type="hidden" name="handicap" value={showHandicap} />
        )}
      </div>

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
          value={showKomi}
          disabled={s.ranked}
          onChange={(e) => set("komi", parseFloat(e.currentTarget.value) || 0)}
        />
        {s.ranked && <input type="hidden" name="komi" value={showKomi} />}
      </div>

      <div>
        <label>Your color</label>
        {s.ranked ? (
          <p class="form-help">
            {showColor === "black"
              ? "Black"
              : showColor === "white"
                ? "White"
                : "Random"}
            {derived &&
              ` (${derived.color === "nigiri" ? "equal rating" : derived.color === "black" ? "lower rating" : "higher rating"})`}
          </p>
        ) : !s.selectedOpponent ? (
          <div class="color-picker">
            <input
              type="radio"
              name="color"
              value="black"
              id="color_black"
              checked={s.color === "black"}
              onChange={() => set("color", "black")}
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
              onChange={() => set("color", "white")}
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
              onChange={() => set("color", "nigiri")}
            />
            <label for="color_nigiri" title="Random">
              <IconNigiri />
            </label>
          </div>
        ) : (
          <div class="color-picker">
            <input
              type="radio"
              name="color"
              value="black"
              id="color_black"
              checked={s.color === "black"}
              onChange={() => set("color", "black")}
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
              onChange={() => set("color", "white")}
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
              onChange={() => set("color", "nigiri")}
            />
            <label for="color_nigiri" title="Random">
              <IconNigiri />
            </label>
          </div>
        )}
        {s.ranked && <input type="hidden" name="color" value={showColor} />}
      </div>
    </>
  );
}
