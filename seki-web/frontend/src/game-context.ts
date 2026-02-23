import type {
  GameState,
  GameStage,
  InitialGameProps,
  UserData,
  ScoreData,
  TerritoryData,
  TurnData,
} from "./goban/types";
import type { Board } from "./board";
import type { ChatEntry } from "./chat";

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
  chatMessages: ChatEntry[];

  // UI state
  analysisMode: boolean;
  estimateMode: boolean;
  board: Board | undefined;
  movesJson: string;
  undoResponseNeeded: boolean;
  errorMessage: string | undefined;
  territoryCountdownMs: number | undefined;
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
    chatMessages: [],

    analysisMode: false,
    estimateMode: false,
    board: undefined,
    movesJson: "[]",
    undoResponseNeeded: false,
    errorMessage: undefined,
    territoryCountdownMs: undefined,
  };
}
