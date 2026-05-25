import type { PlayerPanelProps } from "../../components/player-panel";
import { wsConnected } from "../../ws";
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
  currentTurn: number | null;
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
    currentTurn,
  } = opts;
  // Self-presence uses local WS state (instant, no server round-trip).
  // Opponent presence still comes from the server presence subscription.
  const bOnline = blackUser
    ? stone === 1
      ? wsConnected.value
      : online.has(blackUser.id)
    : false;
  const wOnline = whiteUser
    ? stone === -1
      ? wsConnected.value
      : online.has(whiteUser.id)
    : false;

  const panels = buildPlayerPanels({ komi, captures, score });

  const blackPanel: PlayerPanelProps = {
    ...panels.black,
    userData: blackUser,
    stone: isNigiriPending ? "nigiri" : "black",
    clock: cd.blackText || undefined,
    clockLowTime: cd.blackLow,
    isOnline: bOnline,
    strong: currentTurn === 1,
    rank: blackUser?.rank,
  };
  const whitePanel: PlayerPanelProps = {
    ...panels.white,
    userData: whiteUser,
    stone: isNigiriPending ? "nigiri" : "white",
    clock: cd.whiteText || undefined,
    clockLowTime: cd.whiteLow,
    isOnline: wOnline,
    strong: currentTurn === -1,
    rank: whiteUser?.rank,
  };

  const isWhitePlayer = stone === -1;

  if (position === "top") {
    return isWhitePlayer ? blackPanel : whitePanel;
  }

  return isWhitePlayer ? whitePanel : blackPanel;
}
