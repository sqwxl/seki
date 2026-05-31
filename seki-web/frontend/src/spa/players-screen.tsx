import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { RatingTrend } from "../components/rating-trend";
import { UserLabel } from "../components/user-label";
import { formatAgo } from "../utils/format";
import { fullRankText } from "../utils/rating";
import { requestSpaNavigation } from "../utils/spa-navigation";
import { pageTitle, setHead } from "./head";
import { fetchJson, useRouteData } from "./route-data";
import { ErrorState, LoadingState } from "./screen-state";
import type { PlayerDirectoryItem, PlayersData } from "./types";

const PAGE_SIZE = 50;

type PlayerFilters = {
  excludeUncertain: boolean;
  includeUnranked: boolean;
  onlineNow: boolean;
};

export function buildPlayersUrl(filters: PlayerFilters, offset = 0): string {
  const params = new URLSearchParams();
  params.set("offset", String(offset));
  params.set("limit", String(PAGE_SIZE));
  params.set("exclude_uncertain", String(filters.excludeUncertain));
  params.set("include_unranked", String(filters.includeUnranked));
  params.set("online_now", String(filters.onlineNow));
  return `/api/web/players?${params.toString()}`;
}

function PlayerRow({
  player,
  index,
}: {
  player: PlayerDirectoryItem;
  index: number;
}) {
  const href = `/users/${encodeURIComponent(player.user.display_name)}`;

  function openProfile() {
    requestSpaNavigation(href);
  }

  function onClick(event: MouseEvent) {
    if ((event.target as HTMLElement).closest("a")) {
      return;
    }
    openProfile();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openProfile();
    }
  }

  return (
    <tr
      class="players-row"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <td class="players-rank-number">{index}</td>
      <td>
        <UserLabel
          user={player.user}
          options={{
            showPresence: true,
            presence: player.is_online,
            rank: { value: null },
          }}
        />
      </td>
      <td>{fullRankText(player.user.rank)}</td>
      <td>
        <span class="fg-green">{player.wins}</span>/
        <span class="fg-red">{player.losses}</span>
      </td>
      <td>
        <RatingTrend values={player.rating_trend} />
      </td>
      <td>{formatAgo(player.last_active_at)}</td>
    </tr>
  );
}

export function PlayersScreen() {
  const [filters, setFilters] = useState<PlayerFilters>({
    excludeUncertain: false,
    includeUnranked: false,
    onlineNow: false,
  });
  const firstUrl = useMemo(() => buildPlayersUrl(filters), [filters]);
  const { data, error } = useRouteData<PlayersData>(firstUrl);
  const [players, setPlayers] = useState<PlayerDirectoryItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHead(pageTitle("Players"), "Browse ranked Seki players");
  }, []);

  useEffect(() => {
    if (!data) {
      return;
    }
    setPlayers(data.players);
    setHasMore(data.has_more);
  }, [data]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || loadingMore) {
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) {
        return;
      }

      setLoadingMore(true);
      fetchJson<PlayersData>(buildPlayersUrl(filters, players.length))
        .then((next) => {
          setPlayers((prev) => [...prev, ...next.players]);
          setHasMore(next.has_more);
        })
        .finally(() => setLoadingMore(false));
    });
    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [filters, hasMore, loadingMore, players.length]);

  if (error) {
    return <ErrorState message={error.message} />;
  }

  if (!data) {
    return <LoadingState />;
  }

  return (
    <>
      <h1>Players</h1>
      <div class="players-controls">
        <label>
          <input
            type="checkbox"
            checked={filters.excludeUncertain}
            onChange={(event) =>
              setFilters((prev) => ({
                ...prev,
                excludeUncertain: event.currentTarget.checked,
              }))
            }
          />{" "}
          Exclude uncertain?
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.includeUnranked}
            onChange={(event) =>
              setFilters((prev) => ({
                ...prev,
                includeUnranked: event.currentTarget.checked,
              }))
            }
          />{" "}
          Include unranked?
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.onlineNow}
            onChange={(event) =>
              setFilters((prev) => ({
                ...prev,
                onlineNow: event.currentTarget.checked,
              }))
            }
          />{" "}
          Online now
        </label>
        <label class="disabled-control">
          <input type="checkbox" disabled /> Favorites
        </label>
      </div>
      <div class="players-table-wrap">
        <table class="players-table">
          <thead>
            <tr>
              <th>#</th>
              <th>User</th>
              <th>Rank</th>
              <th>W/L</th>
              <th>Trend</th>
              <th>Last active</th>
            </tr>
          </thead>
          <tbody>
            {players.map((player, idx) => (
              <PlayerRow key={player.user.id} player={player} index={idx + 1} />
            ))}
          </tbody>
        </table>
      </div>
      {players.length === 0 && <p>No players found.</p>}
      {loadingMore && <p>Loading...</p>}
      <div ref={sentinelRef} class="players-scroll-sentinel" />
    </>
  );
}
