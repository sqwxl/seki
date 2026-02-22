import { StoneBlack, StoneWhite } from "./icons";
import { formatSize, formatTimeControl } from "./format";
import type { UserData, GameSettings } from "./format";

type GameDescriptionProps = {
  black: UserData | undefined;
  white: UserData | undefined;
  settings: GameSettings;
  stage: string;
  result: string | null | undefined;
  move_count: number | undefined;
};

function isPlayStage(stage: string): boolean {
  return stage === "black_to_play" || stage === "white_to_play";
}

export function GameDescription(props: GameDescriptionProps) {
  const b = props.black?.display_name ?? "?";
  const w = props.white?.display_name ?? "?";

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
      <StoneBlack /> {b} vs <StoneWhite /> {w} - {parts.join(" - ")}
    </>
  );
}
