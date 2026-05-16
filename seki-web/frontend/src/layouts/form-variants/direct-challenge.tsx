// Direct challenge variant — supports Rated/Unrated toggle
// Rated: opponent list filtered, derived settings (handicap/komi/color) shown as read-only preview
// Unrated: full opponent list, all settings editable; derived settings still previewed when opponent selected

import { useEffect, useRef, useState } from "preact/hooks";
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
import { UserLabel } from "../../components/user-label";
import type { RankData } from "../../game/types";
import { fullRankText } from "../../utils/rating";

type SearchResult = {
  username: string;
  is_registered: boolean;
  is_online: boolean;
  is_recent: boolean;
  rank?: RankData | null;
};

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
  set: <K extends keyof ChallengeSettings>(
    key: K,
    value: ChallengeSettings[K],
  ) => void;
  isRegistered?: boolean;
  currentUserRank?: RankData | null;
  rankedUnavailableReason?: string | null;
  opponentRank?: RankData | null;
  hideOpponentSelect?: boolean;
  showPrivate?: boolean;
};

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

export function DirectChallengeForm({
  s,
  set,
  isRegistered,
  currentUserRank,
  rankedUnavailableReason,
  opponentRank,
  hideOpponentSelect,
  showPrivate = true,
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [recentOpponents, setRecentOpponents] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState<SearchResult | null>(() => {
    if (s.selectedOpponent) {
      return {
        username: s.selectedOpponent,
        is_registered:
          opponentRank?.status === "ranked" ||
          opponentRank?.status === "unranked",
        is_online: false,
        is_recent: false,
        rank: opponentRank,
      };
    }
    return null;
  });
  const [recentsFetched, setRecentsFetched] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const inferredSettingsKeyRef = useRef<string | null>(null);

  const currentRatingText = fullRankText(currentUserRank);

  const opponentCannotRank =
    opponentRank?.status === "anonymous" ||
    opponentRank?.status === "not_participating";

  const rankedBlockedReason = !isRegistered
    ? (rankedUnavailableReason ?? "Register or sign in to create ranked games.")
    : (rankedUnavailableReason ??
      (s.isPrivate ? "Ranked games must be public." : undefined) ??
      (opponentCannotRank
        ? "Opponent is not participating in ranking."
        : undefined));
  const rankedDisabled = Boolean(rankedBlockedReason) || opponentCannotRank;

  const derived = inferSettingsFromRanks(currentUserRank, selected?.rank);

  function inferenceKey(r: SearchResult): string | null {
    if (currentUserRank?.rating == null || r.rank?.rating == null) {
      return null;
    }
    return `${r.username}:${currentUserRank.rating}:${r.rank.rating}`;
  }

  function applyInferredSettings(r: SearchResult) {
    const inferred = inferSettingsFromRanks(currentUserRank, r.rank);
    const key = inferenceKey(r);
    if (!inferred || !key) {
      return;
    }
    set("handicap", inferred.handicap);
    set("komi", inferred.komi);
    set("color", inferred.color);
    inferredSettingsKeyRef.current = key;
  }

  useEffect(() => {
    if (!recentsFetched) {
      setRecentsFetched(true);
      fetch("/users/search")
        .then((r) => r.json())
        .then((data: SearchResult[]) => setRecentOpponents(data))
        .catch(() => {});
    }
  }, [recentsFetched]);

  useEffect(() => {
    if (!s.selectedOpponent || !opponentRank) {
      return;
    }
    setSelected((prev) => {
      if (prev?.username === s.selectedOpponent && prev.rank === opponentRank) {
        return prev;
      }
      return {
        username: s.selectedOpponent,
        is_registered:
          opponentRank.status === "ranked" ||
          opponentRank.status === "unranked",
        is_online:
          prev?.username === s.selectedOpponent ? prev.is_online : false,
        is_recent:
          prev?.username === s.selectedOpponent ? prev.is_recent : false,
        rank: opponentRank,
      };
    });
  }, [s.selectedOpponent, opponentRank]);

  useEffect(() => {
    if (!selected) {
      return;
    }
    const key = inferenceKey(selected);
    if (key && inferredSettingsKeyRef.current !== key) {
      applyInferredSettings(selected);
    }
  }, [selected, currentUserRank?.rating]);

  function doSearch(query: string) {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    fetch(`/users/search?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data: SearchResult[]) => setSearchResults(data))
      .catch(() => {});
  }

  function onSearchInput(value: string) {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value) {
      setSearchResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => doSearch(value), 300);
  }

  function selectOpponent(r: SearchResult) {
    setSelected(r);
    set("selectedOpponent", r.username);
    applyInferredSettings(r);
    setSearchQuery(r.username);
    setSearchResults([]);
  }

  function clearOpponent() {
    setSelected(null);
    inferredSettingsKeyRef.current = null;
    set("selectedOpponent", "");
    setSearchQuery("");
    setSearchResults([]);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  const displayResults = searchQuery ? searchResults : recentOpponents;

  const showHandicap = s.ranked ? (derived?.handicap ?? 0) : s.handicap;
  const showKomi = s.ranked ? (derived?.komi ?? 6.5) : s.komi;
  const showColor = s.ranked ? (derived?.color ?? "black") : s.color;

  return (
    <fieldset>
      <legend>
        <IconSettings /> Settings
      </legend>

      <div>
        <label for="challenge_ranked">
          <IconBell /> Ranked game
        </label>
        <input
          type="checkbox"
          name="ranked"
          id="challenge_ranked"
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

      {!hideOpponentSelect && (
        <fieldset>
          <legend>Opponent</legend>
          {selected ? (
            <span class="selected-opponent" onClick={clearOpponent}>
              <UserLabel
                name={selected.username}
                rank={{ value: selected.rank, showBoth: true }}
              />
            </span>
          ) : (
            <>
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search by username..."
                value={searchQuery}
                onInput={(e) => onSearchInput(e.currentTarget.value)}
                autocomplete="off"
              />
              {displayResults.length > 0 && (
                <ul class="opponent-search-results">
                  {displayResults.map((r) => (
                    <li key={r.username} onClick={() => selectOpponent(r)}>
                      <UserLabel
                        name={r.username}
                        rank={{ value: r.rank, showBoth: true }}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </fieldset>
      )}
      <input type="hidden" name="invite_username" value={s.selectedOpponent} />

      {selected && derived && (
        <div class="form-help" style="margin-bottom: 0.5em">
          {derived.handicap >= 2
            ? `Rating gap ~${derived.handicap} stones — you play ${derived.color === "black" ? "Black" : derived.color === "white" ? "White" : "Random"} with ${derived.handicap}-stone handicap and ${derived.komi} komi.`
            : `Rating gap <2 stones — even game, ${derived.komi} komi. You play ${derived.color === "nigiri" ? "Random" : derived.color === "black" ? "Black" : "White"}.`}
        </div>
      )}

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
        ) : !selected ? (
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
