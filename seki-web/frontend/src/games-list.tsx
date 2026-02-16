import { render } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";
import { subscribe } from "./live";
import { formatGameDescription, type PlayerData, type GameSettings } from "./format";

type LiveGameItem = {
  id: number;
  stage: string;
  result: string | undefined;
  black: PlayerData | undefined;
  white: PlayerData | undefined;
  settings: GameSettings;
  move_count: number | undefined;
};

type GameUpdate = {
  id: number;
  stage: string;
  result: string | undefined;
  black: PlayerData | undefined;
  white: PlayerData | undefined;
  move_count: number | undefined;
};

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

function GamesList() {
  const [games, setGames] = useState<Map<number, LiveGameItem>>(new Map());
  const playerIdRef = useRef<number | undefined>(undefined);
  const [playerId, setPlayerId] = useState<number | undefined>(undefined);

  useEffect(() => {
    const unsubs = [
      subscribe("init", (data) => {
        const msg = data as unknown as InitMessage;
        playerIdRef.current = msg.player_id;
        setPlayerId(msg.player_id);
        const map = new Map<number, LiveGameItem>();
        for (const g of msg.player_games) {
          map.set(g.id, g);
        }
        for (const g of msg.public_games) {
          map.set(g.id, g);
        }
        setGames(map);
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

  const playerGames = allGames.filter((g) => isMyGame(g) && isVisible(g));
  const publicGames = allGames.filter(
    (g) => !isMyGame(g) && !g.settings.is_private && isVisible(g),
  );

  return (
    <>
      <h1>Your games</h1>
      {playerGames.length === 0 ? (
        <p>No games yet.</p>
      ) : (
        <ul>
          {playerGames.map((g) => (
            <li key={g.id}>
              <a href={`/games/${g.id}`}>{formatGameDescription(g)}</a>
            </li>
          ))}
        </ul>
      )}
      <h1>Open games</h1>
      {publicGames.length === 0 ? (
        <p>No open games.</p>
      ) : (
        <ul>
          {publicGames.map((g) => (
            <li key={g.id}>
              <a href={`/games/${g.id}`}>{formatGameDescription(g)}</a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function initGamesList(root: HTMLElement) {
  render(<GamesList />, root);
}

export { initGamesList };
