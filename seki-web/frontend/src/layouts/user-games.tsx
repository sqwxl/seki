import { render } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";
import { subscribe } from "../ws";
import { GameListItem } from "../components/game-description";
import type { LiveGameItem } from "../components/game-description";
import type { GameCreatedMessage, GameUpdatedMessage } from "./games-list";
import type { UserData } from "../game/types";
import { parseDatasetJson } from "../utils/format";
import { readUserData } from "../game/util";

type InitialData = {
  profile_user_id: number;
  games: LiveGameItem[];
};

function involvesUser(
  game: { black: UserData | undefined; white: UserData | undefined },
  userId: number,
): boolean {
  return game.black?.id === userId || game.white?.id === userId;
}

const GAMES_PER_PAGE = 10;

function UserGames({ initial }: { initial?: InitialData }) {
  const currentUserId = readUserData()?.id;
  const [games, setGames] = useState<Map<number, LiveGameItem>>(() => {
    const map = new Map<number, LiveGameItem>();
    if (initial) {
      for (const g of initial.games) {
        map.set(g.id, g);
      }
    }
    return map;
  });
  const [visibleCount, setVisibleCount] = useState(GAMES_PER_PAGE);
  const profileUserIdRef = useRef(initial?.profile_user_id);

  useEffect(() => {
    const unsubs = [
      subscribe<GameCreatedMessage>("game_created", (msg) => {
        const userId = profileUserIdRef.current;
        if (userId != null && involvesUser(msg.game, userId)) {
          setGames((prev) => {
            const next = new Map(prev);
            next.set(msg.game.id, msg.game);
            return next;
          });
        }
      }),

      subscribe<GameUpdatedMessage>("game_updated", (msg) => {
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

      // Don't subscribe to game_removed — profile keeps all games
      // visible, showing aborted/declined with dismissed styling.
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

  const visibleGames = allGames.slice(0, visibleCount);

  return (
    <>
      <ul class="games-list">
        {visibleGames.map((g) => (
          <GameListItem key={g.id} game={g} playerId={currentUserId} />
        ))}
      </ul>
      {visibleCount < allGames.length && (
        <button
          type="button"
          class="btn"
          onClick={() => setVisibleCount((c) => c + GAMES_PER_PAGE)}
        >
          Show more
        </button>
      )}
    </>
  );
}

function initUserGames(root: HTMLElement) {
  const initial = parseDatasetJson<InitialData>(root, "initialGames");
  render(<UserGames initial={initial} />, root);
}

export { initUserGames };
