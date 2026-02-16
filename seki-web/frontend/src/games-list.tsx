import { render } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";
import { subscribe } from "./live";

type LiveGameItem = {
  id: number;
  description: string;
  stage: string;
  result: string | undefined;
  black_id: number | undefined;
  white_id: number | undefined;
  is_private: boolean;
};

type InitMessage = {
  kind: "init";
  player_id: number;
  player_games: LiveGameItem[];
  public_games: LiveGameItem[];
};

type GameUpdatedMessage = {
  kind: "game_updated";
  game: LiveGameItem;
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

      subscribe("game_updated", (data) => {
        const msg = data as unknown as GameUpdatedMessage;
        setGames((prev) => {
          const next = new Map(prev);
          next.set(msg.game.id, msg.game);
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
    (g.black_id === playerId || g.white_id === playerId);

  const isVisible = (g: LiveGameItem) => g.result !== "Aborted";

  const playerGames = allGames.filter((g) => isMyGame(g) && isVisible(g));
  const publicGames = allGames.filter(
    (g) => !isMyGame(g) && !g.is_private && isVisible(g),
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
              <a href={`/games/${g.id}`}>{g.description}</a>
            </li>
          ))}
        </ul>
      )}
      <h1>Public games</h1>
      {publicGames.length === 0 ? (
        <p>No public games.</p>
      ) : (
        <ul>
          {publicGames.map((g) => (
            <li key={g.id}>
              <a href={`/games/${g.id}`}>{g.description}</a>
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
