import type {
  GameState,
  GameStage,
  InitialGameProps,
  Point,
  UserData,
  ScoreData,
  TerritoryData,
  TurnData,
} from "./goban/types";
import type { Board } from "./board";

export type GameCtx = {
  // Immutable config (set once)
  gameId: number;
  playerStone: number;
  initialProps: InitialGameProps;

  // Mutable game state
  gameState: GameState;
  gameStage: GameStage;
  currentTurn: number | null;
  moves: TurnData[];
  black: UserData | undefined;
  white: UserData | undefined;
  result: string | null;
  territory: TerritoryData | undefined;
  settledScore: ScoreData | undefined;
  onlineUsers: Set<number>;
  undoRejected: boolean;
  allowUndo: boolean;

  // UI state
  analysisMode: boolean;
  board: Board | undefined;
  movesJson: string;
  premove: Point | undefined;
};

export function createGameContext(
  gameId: number,
  playerStone: number,
  initialProps: InitialGameProps,
): GameCtx {
  return {
    gameId,
    playerStone,
    initialProps,

    gameState: initialProps.state,
    gameStage: initialProps.stage,
    currentTurn: null,
    moves: [],
    black: initialProps.black ?? undefined,
    white: initialProps.white ?? undefined,
    result: null,
    territory: undefined,
    settledScore: undefined,
    onlineUsers: new Set(),
    undoRejected: false,
    allowUndo: false,

    analysisMode: false,
    board: undefined,
    movesJson: "[]",
    premove: undefined,
  };
}
