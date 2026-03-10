import { GameStage, type UserData, type GameSettings } from "../game/types";
import { UserLabel } from "./user-label";
import { IconPrivate } from "./icons";
import { buildDescriptionParts } from "../utils/format";

export type GameUpdate = {
  id: number;
  stage: GameStage;
  result: string | undefined;
  black: UserData | undefined;
  white: UserData | undefined;
  move_count: number | undefined;
};

export type LiveGameItem = {
  id: number;
  creator_id: number | undefined;
  stage: GameStage;
  result: string | undefined;
  black: UserData | undefined;
  white: UserData | undefined;
  settings: GameSettings;
  move_count: number | undefined;
  unread?: boolean;
};

export function isMyTurn(
  game: {
    stage: GameStage;
    creator_id?: number;
    black?: { id: number };
    white?: { id: number };
  },
  playerId: number | undefined,
): boolean {
  if (playerId == null) {
    return false;
  }
  switch (game.stage) {
    case GameStage.BlackToPlay:
      return game.black?.id === playerId;
    case GameStage.WhiteToPlay:
      return game.white?.id === playerId;
    case GameStage.Challenge:
      return (
        game.creator_id !== playerId &&
        (game.black?.id === playerId || game.white?.id === playerId)
      );
    default:
      return false;
  }
}

export function GameListItem({
  game,
  playerId,
}: {
  game: LiveGameItem;
  playerId: number | undefined;
}) {
  const dismissed = game.result === "Aborted" || game.result === "Declined";
  const classes = [
    isMyTurn(game, playerId) ? "your-turn" : "",
    dismissed ? "dismissed" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <li
      key={game.id}
      class={classes || undefined}
      title={isMyTurn(game, playerId) ? "Your turn" : undefined}
    >
      <a href={`/games/${game.id}`}>
        {game.settings.is_private && (
          <span class="private-badge" title="Private">
            <IconPrivate />
          </span>
        )}
        <GameDescription {...game} dismissed={dismissed} />
      </a>
    </li>
  );
}

export function GameDescription(props: LiveGameItem & { dismissed?: boolean }) {
  const b = props.black?.display_name ?? "?";
  const w = props.white?.display_name ?? "?";

  // Show creator first; fall back to black vs white (e.g. SGF imports)
  const creatorIsWhite =
    props.creator_id != null && props.white?.id === props.creator_id;
  const first = creatorIsWhite ? w : b;
  const second = creatorIsWhite ? b : w;
  const firstStone: "black" | "white" = creatorIsWhite ? "white" : "black";
  const secondStone: "black" | "white" = creatorIsWhite ? "black" : "white";

  const parts = buildDescriptionParts(props);

  if (props.dismissed && props.result) {
    // Render result outside the struck-through content
    const partsWithoutResult = parts.filter((p) => p !== props.result);
    return (
      <>
        <span class="dismissed-content">
          <UserLabel name={first} stone={firstStone} /> vs{" "}
          <UserLabel name={second} stone={secondStone} />
          {partsWithoutResult.length > 0 &&
            ` - ${partsWithoutResult.join(" - ")}`}
        </span>
        {" - "}
        {props.result}
      </>
    );
  }

  return (
    <>
      <UserLabel name={first} stone={firstStone} /> vs{" "}
      <UserLabel name={second} stone={secondStone} /> - {parts.join(" - ")}
    </>
  );
}
