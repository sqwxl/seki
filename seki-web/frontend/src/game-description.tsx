import { formatSize, formatTimeControl } from "./format";
import type { UserData, GameSettings } from "./format";
import { UserLabel } from "./user-label";

export type GameUpdate = {
  id: number;
  stage: string;
  result: string | undefined;
  black: UserData | undefined;
  white: UserData | undefined;
  move_count: number | undefined;
};

export type LiveGameItem = {
  id: number;
  creator_id: number | undefined;
  stage: string;
  result: string | undefined;
  black: UserData | undefined;
  white: UserData | undefined;
  settings: GameSettings;
  move_count: number | undefined;
};

function isPlayStage(stage: string): boolean {
  return stage === "black_to_play" || stage === "white_to_play";
}

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

  const parts: string[] = [
    formatSize(props.settings.cols, props.settings.rows),
  ];

  if (props.settings.handicap >= 2) {
    parts.push(`H${props.settings.handicap}`);
  }

  const tc = formatTimeControl(props.settings);
  if (tc) {
    parts.push(tc);
  }

  if (props.result) {
    parts.push(props.result);
  } else if (
    (isPlayStage(props.stage) || props.stage === "territory_review") &&
    props.move_count != null
  ) {
    parts.push(`Move ${props.move_count}`);
  }

  return (
    <>
      <UserLabel name={first} stone={firstStone} /> vs{" "}
      <UserLabel name={second} stone={secondStone} /> - {parts.join(" - ")}
    </>
  );
}
