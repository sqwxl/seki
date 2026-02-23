import { render } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";
import { subscribe } from "../ws";
import { GameDescription } from "../components/game-description";
import type { LiveGameItem, GameUpdate } from "../components/game-description";
import type { UserData } from "../utils/format";

type InitMessage = {
  kind: "init";
  player_id: number;
  player_games: LiveGameItem[];
  public_games: LiveGameItem[];
};

type GameCreatedMessage = {
  kind: "game_created";
  game: LiveGameItem;
};

type GameUpdatedMessage = {
  kind: "game_updated";
  game: GameUpdate;
};

type GameRemovedMessage = {
  kind: "game_removed";
  game_id: number;
};

function parseInitialGames(root: HTMLElement): InitMessage | undefined {
  const json = root.dataset.initialGames;
  if (!json) {
    return undefined;
  }
  try {
    return JSON.parse(json) as InitMessage;
  } catch {
    return undefined;
  }
}

function buildGamesMap(msg: InitMessage): Map<number, LiveGameItem> {
  const map = new Map<number, LiveGameItem>();
  for (const g of msg.player_games) {
    map.set(g.id, g);
  }
  for (const g of msg.public_games) {
    map.set(g.id, g);
  }
  return map;
}

function GamesList({ initial }: { initial?: InitMessage }) {
  const [games, setGames] = useState<Map<number, LiveGameItem>>(() =>
    initial ? buildGamesMap(initial) : new Map(),
  );
  const playerIdRef = useRef<number | undefined>(initial?.player_id);
  const [playerId, setPlayerId] = useState<number | undefined>(
    initial?.player_id,
  );

  useEffect(() => {
    const unsubs = [
      subscribe("init", (data) => {
        const msg = data as unknown as InitMessage;
        playerIdRef.current = msg.player_id;
        setPlayerId(msg.player_id);
        setGames(buildGamesMap(msg));
      }),

      subscribe("game_created", (data) => {
        const msg = data as unknown as GameCreatedMessage;
        setGames((prev) => {
          const next = new Map(prev);
          next.set(msg.game.id, msg.game);
          return next;
        });
      }),

      subscribe("game_updated", (data) => {
        const msg = data as unknown as GameUpdatedMessage;
        setGames((prev) => {
          const existing = prev.get(msg.game.id);
          if (!existing) {
            return prev;
          }
          const next = new Map(prev);
          next.set(msg.game.id, { ...existing, ...msg.game });
          return next;
        });
      }),

      subscribe("game_removed", (data) => {
        const msg = data as unknown as GameRemovedMessage;
        setGames((prev) => {
          const next = new Map(prev);
          next.delete(msg.game_id);
          return next;
        });
      }),
    ];

    return () => {
      for (const unsub of unsubs) {
        unsub();
      }
    };
  }, []);

  const allGames = [...games.values()];

  const isMyGame = (g: LiveGameItem) =>
    playerId !== undefined &&
    (g.black?.id === playerId || g.white?.id === playerId);

  const isVisible = (g: LiveGameItem) => g.result !== "Aborted";

  const userGames = allGames.filter((g) => isMyGame(g) && isVisible(g));
  const openGames = allGames.filter(
    (g) =>
      !isMyGame(g) &&
      !g.settings.is_private &&
      isVisible(g) &&
      (!g.black || !g.white),
  );
  const publicGames = allGames.filter(
    (g) =>
      !isMyGame(g) &&
      !g.settings.is_private &&
      isVisible(g) &&
      g.black &&
      g.white,
  );

  return (
    <>
      <h1>Your games</h1>
      {userGames.length === 0 ? (
        <p>No games yet.</p>
      ) : (
        <ul class="games-list">
          {userGames.map((g) => (
            <li key={g.id}>
              <a href={`/games/${g.id}`}>
                <GameDescription {...g} />
              </a>
            </li>
          ))}
        </ul>
      )}
      <h1>Open games</h1>
      {openGames.length === 0 ? (
        <p>No open games.</p>
      ) : (
        <ul class="games-list">
          {openGames.map((g) => (
            <li key={g.id}>
              <a href={`/games/${g.id}`}>
                <GameDescription {...g} />
              </a>
            </li>
          ))}
        </ul>
      )}
      <h1>Public games</h1>
      {publicGames.length === 0 ? (
        <p>No public games.</p>
      ) : (
        <ul class="games-list">
          {publicGames.map((g) => (
            <li key={g.id}>
              <a href={`/games/${g.id}`}>
                <GameDescription {...g} />
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function initGamesList(root: HTMLElement) {
  const initial = parseInitialGames(root);
  render(<GamesList initial={initial} />, root);
}

export { initGamesList };
