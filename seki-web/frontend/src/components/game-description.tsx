import type { UserData, GameSettings, GameStage } from "../goban/types";
import { UserLabel } from "./user-label";
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
};

export function GameDescription(props: LiveGameItem) {
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

  return (
    <>
      <UserLabel name={first} stone={firstStone} /> vs{" "}
      <UserLabel name={second} stone={secondStone} /> - {parts.join(" - ")}
    </>
  );
}
