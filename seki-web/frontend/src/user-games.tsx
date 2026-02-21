import { render } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";
import { subscribe } from "./live";
import {
  formatGameDescription,
  type UserData,
  type GameSettings,
} from "./format";

type LiveGameItem = {
  id: number;
  stage: string;
  result: string | undefined;
  black: UserData | undefined;
  white: UserData | undefined;
  settings: GameSettings;
  move_count: number | undefined;
};

type GameUpdate = {
  id: number;
  stage: string;
  result: string | undefined;
  black: UserData | undefined;
  white: UserData | undefined;
  move_count: number | undefined;
};

type InitialData = {
  profile_user_id: number;
  games: LiveGameItem[];
};

function parseInitialData(root: HTMLElement): InitialData | undefined {
  const json = root.dataset.initialGames;
  if (!json) {
    return undefined;
  }
  try {
    return JSON.parse(json) as InitialData;
  } catch {
    return undefined;
  }
}

function involvesUser(
  game: { black: UserData | undefined; white: UserData | undefined },
  userId: number,
): boolean {
  return game.black?.id === userId || game.white?.id === userId;
}

function UserGames({ initial }: { initial?: InitialData }) {
  const [games, setGames] = useState<Map<number, LiveGameItem>>(
    () => {
      const map = new Map<number, LiveGameItem>();
      if (initial) {
        for (const g of initial.games) {
          map.set(g.id, g);
        }
      }
      return map;
    },
  );
  const profileUserIdRef = useRef(initial?.profile_user_id);

  useEffect(() => {
    const unsubs = [
      subscribe("game_created", (data) => {
        const msg = data as unknown as { game: LiveGameItem };
        const userId = profileUserIdRef.current;
        if (userId != null && involvesUser(msg.game, userId)) {
          setGames((prev) => {
            const next = new Map(prev);
            next.set(msg.game.id, msg.game);
            return next;
          });
        }
      }),

      subscribe("game_updated", (data) => {
        const msg = data as unknown as { game: GameUpdate };
        setGames((prev) => {
          const existing = prev.get(msg.game.id);
          if (!existing) {
            // Check if the update now involves the profile user
            const userId = profileUserIdRef.current;
            if (userId != null && involvesUser(msg.game, userId)) {
              // We don't have settings for this game, so we can't add it.
              // It'll show up on next page load.
              return prev;
            }
            return prev;
          }
          const next = new Map(prev);
          next.set(msg.game.id, { ...existing, ...msg.game });
          return next;
        });
      }),

      subscribe("game_removed", (data) => {
        const msg = data as unknown as { game_id: number };
        setGames((prev) => {
          if (!prev.has(msg.game_id)) {
            return prev;
          }
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

  if (allGames.length === 0) {
    return <p>No games yet.</p>;
  }

  return (
    <ul>
      {allGames.map((g) => (
        <li key={g.id}>
          <a href={`/games/${g.id}`}>{formatGameDescription(g)}</a>
        </li>
      ))}
    </ul>
  );
}

function initUserGames(root: HTMLElement) {
  const initial = parseInitialData(root);
  render(<UserGames initial={initial} />, root);
}

export { initUserGames };
