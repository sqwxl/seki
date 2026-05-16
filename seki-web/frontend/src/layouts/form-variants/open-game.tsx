// Open game variant — supports Rated/Unrated toggle
// Rated: board locked to 19×19, komi/color absent, max handicap slider shown
// Unrated: full settings editable

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
import type { RankData } from "../../game/types";
import { fullRankText } from "../../utils/rating";

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
  set: <K extends keyof OpenGameSettings>(
    key: K,
    value: OpenGameSettings[K],
  ) => void;
  isRegistered?: boolean;
  currentUserRank?: RankData | null;
  rankedUnavailableReason?: string | null;
  showPrivate?: boolean;
};

function maxHandicapForBoard(size: number): number {
  if (size % 2 === 0 || size < 7) return 0;
  return size >= 13 ? 9 : 5;
}

export function OpenGameForm({
  s,
  set,
  isRegistered,
  currentUserRank,
  rankedUnavailableReason,
  showPrivate = true,
}: Props) {
  const currentRatingText = fullRankText(currentUserRank);

  const rankedBlockedReason = !isRegistered
    ? (rankedUnavailableReason ?? "Register or sign in to create ranked games.")
    : (rankedUnavailableReason ??
      (s.isPrivate ? "Ranked games must be public." : undefined));
  const rankedDisabled = Boolean(rankedBlockedReason);

  return (
    <fieldset>
      <legend>
        <IconSettings />
        Settings
      </legend>

      <div>
        <label for="open_ranked">
          <IconBell /> Ranked game
        </label>
        <input
          type="checkbox"
          name="ranked"
          id="open_ranked"
          value="true"
          checked={s.ranked}
          onChange={(e) => set("ranked", e.currentTarget.checked)}
          disabled={!isRegistered || rankedDisabled}
        />
        <p class="form-help">
          {rankedDisabled
            ? rankedBlockedReason
            : currentRatingText
              ? `Your current rating is ${currentRatingText}.`
              : "Your first ranked game starts from a provisional rating."}
        </p>
      </div>

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

      {s.ranked ? (
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
              set("maxHandicap", parseInt(e.currentTarget.value, 10))
            }
          />
          <span class="form-help">Max {s.maxHandicap} stones</span>
        </div>
      ) : (
        <>
          <div>
            <label for="handicap">
              <IconHandicap /> Handicap
            </label>
            <select
              name="handicap"
              id="handicap"
              value={s.handicap}
              onChange={(e) =>
                set("handicap", parseInt(e.currentTarget.value, 10))
              }
            >
              <option value={0}>None</option>
              {Array.from(
                { length: Math.max(0, maxHandicapForBoard(s.cols) - 1) },
                (_, i) => {
                  const v = i + 2;
                  return (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  );
                },
              )}
            </select>
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
              value={s.komi}
              onChange={(e) =>
                set("komi", parseFloat(e.currentTarget.value) || 0)
              }
            />
          </div>
          <div>
            <label>Your color</label>
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
          </div>
        </>
      )}

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
          onChange={(e) => set("allowUndo", e.currentTarget.checked)}
        />
      </div>

      {showPrivate && (
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
            disabled={s.ranked}
            onChange={(e) => set("isPrivate", e.currentTarget.checked)}
          />
          {s.ranked && <input type="hidden" name="is_private" value="false" />}
          <p class="form-help">
            Hide this game from public lists. Non-participants need the invite
            link to view it.
          </p>
        </div>
      )}
    </fieldset>
  );
}
