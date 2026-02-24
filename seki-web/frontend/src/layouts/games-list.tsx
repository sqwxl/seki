import { render } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";
import { subscribe } from "../ws";
import { GameDescription } from "../components/game-description";
import type { LiveGameItem, GameUpdate } from "../components/game-description";
import { GameStage } from "../goban/types";
import { parseDatasetJson } from "../utils/format";
import type { UserData } from "../utils/format";

export type InitMessage = {
  kind: "init";
  player_id: number;
  player_games: LiveGameItem[];
  public_games: LiveGameItem[];
};

export type GameCreatedMessage = {
  kind: "game_created";
  game: LiveGameItem;
};

export type GameUpdatedMessage = {
  kind: "game_updated";
  game: GameUpdate;
};

export type GameRemovedMessage = {
  kind: "game_removed";
  game_id: number;
};

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

function GameSection({
  title,
  games,
  emptyText,
}: {
  title: string;
  games: LiveGameItem[];
  emptyText?: string;
}) {
  if (!emptyText && games.length === 0) {
    return null;
  }
  return (
    <>
      <h1>{title}</h1>
      {games.length === 0 ? (
        <p>{emptyText}</p>
      ) : (
        <ul class="games-list">
          {games.map((g) => (
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
      subscribe<InitMessage>("init", (msg) => {
        playerIdRef.current = msg.player_id;
        setPlayerId(msg.player_id);
        setGames(buildGamesMap(msg));
      }),

      subscribe<GameCreatedMessage>("game_created", (msg) => {
        setGames((prev) => {
          const next = new Map(prev);
          next.set(msg.game.id, msg.game);
          return next;
        });
      }),

      subscribe<GameUpdatedMessage>("game_updated", (msg) => {
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

      subscribe<GameRemovedMessage>("game_removed", (msg) => {
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

  const isVisible = (g: LiveGameItem) =>
    g.result !== "Aborted" && g.result !== "Declined";

  const isIncomingChallenge = (g: LiveGameItem) =>
    g.stage === GameStage.Challenge && g.creator_id !== playerId;

  const challenges = allGames.filter(
    (g) => isMyGame(g) && isVisible(g) && isIncomingChallenge(g),
  );
  const userGames = allGames.filter(
    (g) => isMyGame(g) && isVisible(g) && !isIncomingChallenge(g),
  );
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
      <GameSection title="Challenges" games={challenges} />
      <GameSection title="Your games" games={userGames} emptyText="No games yet." />
      <GameSection title="Open games" games={openGames} emptyText="No open games." />
      <GameSection title="Public games" games={publicGames} emptyText="No public games." />
    </>
  );
}

function initGamesList(root: HTMLElement) {
  const initial = parseDatasetJson<InitMessage>(root, "initialGames");
  render(<GamesList initial={initial} />, root);
}

export { initGamesList };
