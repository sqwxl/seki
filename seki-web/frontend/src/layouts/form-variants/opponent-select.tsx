import { useEffect, useRef, useState } from "preact/hooks";
import { UserLabel } from "../../components/user-label";
import type { DerivedHandicapKomi, RankData, UserData } from "../../game/types";

export type OpponentSearchResult = {
  user_data: UserData;
  is_online: boolean;
  is_recent: boolean;
  derived_handicap_komi?: DerivedHandicapKomi | null;
};

type SelectedOpponent =
  | OpponentSearchResult
  | {
      username: string;
      user_data?: null;
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

function opponentName(result: SelectedOpponent): string {
  return (
    result.user_data?.display_name ??
    ("username" in result ? result.username : "")
  );
}

function getOpponentRank(
  result: SelectedOpponent,
): RankData | null | undefined {
  return result.user_data?.rank ?? ("rank" in result ? result.rank : null);
}

function canSelectRatedOpponent(result: SelectedOpponent): boolean {
  const rank = getOpponentRank(result);
  return rank?.status === "ranked" || rank?.status === "unranked";
}

function filterOpponentResults(
  results: OpponentSearchResult[],
  rated: boolean,
): OpponentSearchResult[] {
  return rated ? results.filter(canSelectRatedOpponent) : results;
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
  const [selected, setSelected] = useState<SelectedOpponent | null>(() => {
    if (selectedOpponent) {
      return {
        username: selectedOpponent,
        user_data: null,
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
      if (
        prev &&
        opponentName(prev) === selectedOpponent &&
        getOpponentRank(prev) === opponentRank
      ) {
        return prev;
      }

      return {
        username: selectedOpponent,
        user_data:
          prev && opponentName(prev) === selectedOpponent
            ? (prev.user_data ?? null)
            : null,
        is_online:
          prev && opponentName(prev) === selectedOpponent
            ? prev.is_online
            : false,
        is_recent:
          prev && opponentName(prev) === selectedOpponent
            ? prev.is_recent
            : false,
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
    setSelectedOpponent(r.user_data.display_name);
    onSelectOpponent?.(r);
    setSearchQuery(r.user_data.display_name);
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
          {selected.user_data ? (
            <UserLabel
              user={selected.user_data}
              noLink
              options={{
                showPresence: true,
                presence: selected.is_online,
                rank: { value: getOpponentRank(selected), showBoth: true },
              }}
            />
          ) : (
            opponentName(selected)
          )}
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
                <li key={r.user_data.id} onClick={() => selectOpponent(r)}>
                  <UserLabel
                    user={r.user_data}
                    noLink
                    options={{
                      showPresence: true,
                      presence: r.is_online,
                      rank: { value: getOpponentRank(r), showBoth: true },
                    }}
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
