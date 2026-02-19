import type {
  GameState,
  GameStage,
  InitialGameProps,
  UserData,
  ScoreData,
  TerritoryData,
  TurnData,
} from "./goban/types";
import type { Board } from "./wasm-board";

export type GameCtx = {
  // Immutable config (set once)
  gameId: number;
  playerStone: number;
  initialProps: InitialGameProps;
  analysisStorageKey: string;

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
    analysisStorageKey: `seki:game:${gameId}:analysis`,

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
  };
}
