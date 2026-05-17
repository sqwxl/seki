import type { PlayerPanelProps } from "../../components/player-panel";
import type { UserData } from "../types";
import type { PanelScoreFields, ScoreInput } from "./types";

export function buildPlayerPanels(input: ScoreInput): {
  black: PanelScoreFields;
  white: PanelScoreFields;
} {
  const { komi, captures, score } = input;

  return {
    black: {
      captures: score ? score.black.captures : captures.black,
      komi: komi < 0 ? -komi : undefined,
      territory: score?.black.territory,
    },
    white: {
      captures: score ? score.white.captures : captures.white,
      komi: komi > 0 ? komi : undefined,
      territory: score?.white.territory,
    },
  };
}

export function derivePlayerPanel(opts: {
  position: "top" | "bottom";
  stone: number;
  blackUser: UserData | undefined;
  whiteUser: UserData | undefined;
  online: Map<number, UserData>;
  komi: number;
  captures: { black: number; white: number };
  score: ScoreInput["score"];
  cd: {
    blackText: string;
    whiteText: string;
    blackLow: boolean;
    whiteLow: boolean;
  };
  isNigiriPending: boolean;
}): PlayerPanelProps {
  const {
    position,
    stone,
    blackUser,
    whiteUser,
    online,
    komi,
    captures,
    score,
    cd,
    isNigiriPending,
  } = opts;
  const bName = blackUser ? blackUser.display_name : "...";
  const wName = whiteUser ? whiteUser.display_name : "...";
  const bUrl = blackUser ? `/users/${blackUser.display_name}` : undefined;
  const wUrl = whiteUser ? `/users/${whiteUser.display_name}` : undefined;
  const bOnline = blackUser ? online.has(blackUser.id) : false;
  const wOnline = whiteUser ? online.has(whiteUser.id) : false;

  const panels = buildPlayerPanels({ komi, captures, score });

  const blackPanel: PlayerPanelProps = {
    ...panels.black,
    name: bName,
    stone: isNigiriPending ? "nigiri" : "black",
    clock: cd.blackText || undefined,
    clockLowTime: cd.blackLow,
    profileUrl: bUrl,
    isOnline: bOnline,
    rank: blackUser?.rank,
  };
  const whitePanel: PlayerPanelProps = {
    ...panels.white,
    name: wName,
    stone: isNigiriPending ? "nigiri" : "white",
    clock: cd.whiteText || undefined,
    clockLowTime: cd.whiteLow,
    profileUrl: wUrl,
    isOnline: wOnline,
    rank: whiteUser?.rank,
  };

  const isWhitePlayer = stone === -1;

  if (position === "top") {
    return isWhitePlayer ? blackPanel : whitePanel;
  }

  return isWhitePlayer ? whitePanel : blackPanel;
}
