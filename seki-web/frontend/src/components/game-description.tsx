import { GameStage, type GameSettings, type UserData } from "../game/types";
import { buildDescriptionParts } from "../utils/format";
import { UserLabel } from "./user-label";

export type GameUpdate = {
  id: number;
  stage: GameStage;
  result: string | undefined;
  creator?: UserData | undefined;
  opponent?: UserData | undefined;
  black: UserData | undefined;
  white: UserData | undefined;
  settings?: GameSettings;
  move_count: number | undefined;
};

export type LiveGameItem = {
  id: number;
  creator_id: number | undefined;
  creator?: UserData | undefined;
  opponent?: UserData | undefined;
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
    opponent?: { id: number };
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
        (game.opponent?.id === playerId ||
          game.black?.id === playerId ||
          game.white?.id === playerId)
      );
    default:
      return false;
  }
}

export function GameListItem({
  game,
  playerId,
  noLink,
}: {
  game: LiveGameItem;
  playerId: number | undefined;
  noLink?: boolean;
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
      {noLink ? (
        <GameDescription {...game} dismissed={dismissed} />
      ) : (
        <a href={`/games/${game.id}`}>
          <GameDescription {...game} dismissed={dismissed} />
        </a>
      )}
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

function playerLabel(
  user: UserData | undefined,
  fallback: string,
  stone?: "black" | "white",
  strong?: boolean,
) {
  if (!user) {
    return (
      <span class={`user-label${strong ? " active-turn" : ""}`}>
        {fallback}
      </span>
    );
  }

  return <UserLabel user={user} noLink options={{ stone, strong }} />;
}

export function GameDescription(props: LiveGameItem & { dismissed?: boolean }) {
  const active = activeStone(props.stage);
  const colorsAssigned = !!props.black && !!props.white;
  const parts = buildDescriptionParts(props);

  if (props.dismissed && props.result) {
    const partsWithoutResult = parts.filter((p) => p !== props.result);

    return (
      <>
        <span class="dismissed-content">
          {colorsAssigned
            ? playerLabel(props.black, "???", "black")
            : playerLabel(props.creator, "???")}{" "}
          vs{" "}
          {colorsAssigned
            ? playerLabel(props.white, "???", "white")
            : playerLabel(props.opponent, "???")}
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
      {colorsAssigned
        ? playerLabel(props.black, "???", "black", active === "black")
        : playerLabel(props.creator, "???")}{" "}
      vs{" "}
      {colorsAssigned
        ? playerLabel(props.white, "???", "white", active === "white")
        : playerLabel(props.opponent, "???")}{" "}
      - {parts.join(" - ")}
    </>
  );
}
