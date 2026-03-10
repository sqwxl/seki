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

function activeStone(stage: GameStage): "black" | "white" | undefined {
  if (stage === GameStage.BlackToPlay) {
    return "black";
  }
  if (stage === GameStage.WhiteToPlay) {
    return "white";
  }
  return undefined;
}

export function GameDescription(props: LiveGameItem & { dismissed?: boolean }) {
  const b = props.black?.display_name ?? "?";
  const w = props.white?.display_name ?? "?";
  const active = activeStone(props.stage);

  const parts = buildDescriptionParts(props);

  if (props.dismissed && props.result) {
    const partsWithoutResult = parts.filter((p) => p !== props.result);
    return (
      <>
        <span class="dismissed-content">
          <UserLabel name={b} stone="black" /> vs{" "}
          <UserLabel name={w} stone="white" />
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
      <UserLabel name={b} stone="black" bold={active === "black"} /> vs{" "}
      <UserLabel name={w} stone="white" bold={active === "white"} /> -{" "}
      {parts.join(" - ")}
    </>
  );
}
