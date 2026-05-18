import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
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
import { UserLabel } from "../../components/user-label";
import type { RankData } from "../../game/types";

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

export type OpponentSearchResult = {
  username: string;
  is_registered: boolean;
  is_online: boolean;
  is_recent: boolean;
  rank?: RankData | null;
};

type OpponentSelectProps = {
  selectedOpponent: string;
  setSelectedOpponent: (username: string) => void;
  opponentRank?: RankData | null;
  rated?: boolean;
  onSelectOpponent?: (result: OpponentSearchResult | null) => void;
};

function canSelectRatedOpponent(result: OpponentSearchResult): boolean {
  return result.rank?.status === "ranked" || result.rank?.status === "unranked";
}

function filterOpponentResults(
  results: OpponentSearchResult[],
  rated: boolean,
): OpponentSearchResult[] {
  return rated ? results.filter(canSelectRatedOpponent) : results;
}

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

export function OpponentSelect({
  selectedOpponent,
  setSelectedOpponent,
  opponentRank,
  rated = false,
  onSelectOpponent,
}: OpponentSelectProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<OpponentSearchResult[]>(
    [],
  );
  const [recentOpponents, setRecentOpponents] = useState<
    OpponentSearchResult[]
  >([]);
  const [selected, setSelected] = useState<OpponentSearchResult | null>(() => {
    if (selectedOpponent) {
      return {
        username: selectedOpponent,
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
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!selectedOpponent) {
      setSelected(null);

      return;
    }

    setSelected((prev) => {
      if (prev?.username === selectedOpponent && prev.rank === opponentRank) {
        return prev;
      }

      return {
        username: selectedOpponent,
        is_registered:
          opponentRank?.status === "ranked" ||
          opponentRank?.status === "unranked",
        is_online: prev?.username === selectedOpponent ? prev.is_online : false,
        is_recent: prev?.username === selectedOpponent ? prev.is_recent : false,
        rank: opponentRank,
      };
    });
  }, [selectedOpponent, opponentRank]);

  useEffect(() => {
    fetch("/users/search")
      .then((r) => r.json())
      .then((data: OpponentSearchResult[]) =>
        setRecentOpponents(filterOpponentResults(data, rated)),
      )
      .catch(() => {});
  }, [rated]);

  useEffect(() => {
    if (!rated || !selected) {
      return;
    }

    if (!canSelectRatedOpponent(selected)) {
      setSelected(null);
      setSelectedOpponent("");
      onSelectOpponent?.(null);
      setSearchQuery("");
      setSearchResults([]);
    }
  }, [rated, selected, setSelectedOpponent, onSelectOpponent]);

  useEffect(() => {
    if (!searchQuery) {
      setSearchResults([]);

      return;
    }

    doSearch(searchQuery, rated);
  }, [rated]);

  function doSearch(query: string, ratedSearch = rated) {
    abortRef.current?.abort();

    const controller = new AbortController();
    abortRef.current = controller;

    fetch(`/users/search?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data: OpponentSearchResult[]) =>
        setSearchResults(filterOpponentResults(data, ratedSearch)),
      )
      .catch(() => {});
  }

  function onSearchInput(value: string) {
    setSearchQuery(value);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!value) {
      setSearchResults([]);

      return;
    }

    debounceRef.current = setTimeout(() => doSearch(value), 300);
  }

  function selectOpponent(r: OpponentSearchResult) {
    setSelected(r);
    setSelectedOpponent(r.username);
    onSelectOpponent?.(r);
    setSearchQuery(r.username);
    setSearchResults([]);
  }

  function clearOpponent() {
    setSelected(null);
    setSelectedOpponent("");
    onSelectOpponent?.(null);
    setSearchQuery("");
    setSearchResults([]);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  const displayResults = searchQuery ? searchResults : recentOpponents;

  return (
    <div>
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

export function maxHandicapForBoard(size: number): number {
  if (size % 2 === 0 || size < 7) {
    return 0;
  }

  return size >= 13 ? 9 : 5;
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
        <IconPlus /> Handicap
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
