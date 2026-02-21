export type Sign = 0 | 1 | -1;
export type Point = [number, number];
export type SignMap = Sign[][];

export type MarkerData = {
  type: string;
  label?: string;
};

export type HeatData = {
  strength: number;
  text?: string | number;
};

export type GhostStoneData = {
  sign: Sign;
  type?: string;
  faint?: boolean;
};

export type LineData = {
  v1: Point;
  v2: Point;
  type?: string;
};

export type VertexEventHandler = (evt: Event, position: Point) => void;

export enum Stone {
  Black = 1,
  White = -1,
}

// Keep in sync with go-engine Stage enum (go-engine/src/engine.rs)
export enum GameStage {
  Unstarted = "unstarted",
  BlackToPlay = "black_to_play",
  WhiteToPlay = "white_to_play",
  TerritoryReview = "territory_review",
  Done = "done",
}

export function isPlayStage(stage: GameStage): boolean {
  return stage === GameStage.BlackToPlay || stage === GameStage.WhiteToPlay;
}

export type Captures = {
  black: number;
  white: number;
};

export type Ko = {
  pos: [number, number];
  illegal: Stone;
};

// Keep in sync with go-engine GameState (go-engine/src/engine.rs)
export type GameState = {
  board: number[];
  cols: number;
  rows: number;
  captures: Captures;
  ko?: { pos: [number, number]; stone: number } | null;
};

export type TurnData = {
  kind: "play" | "pass" | "resign";
  stone: number;
  pos: [number, number] | null;
};

// Keep in sync with go-engine GameTree (go-engine/src/game_tree.rs)
export type TreeNodeData = {
  turn: TurnData;
  parent: number | null;
  children: number[];
};

export type GameTreeData = {
  nodes: TreeNodeData[];
  root_children: number[];
};

export type UserData = {
  id: number;
  display_name: string;
  is_registered: boolean;
};

export type PlayerPoints = {
  territory: number;
  captures: number;
};

export type ScoreData = {
  black: PlayerPoints;
  white: PlayerPoints;
};

export type TerritoryData = {
  ownership: number[];
  dead_stones: [number, number][];
  score: ScoreData;
  black_approved: boolean;
  white_approved: boolean;
};

export type GameSettings = {
  cols: number;
  rows: number;
  handicap: number;
  time_control: "none" | "fischer" | "byoyomi" | "correspondence";
  main_time_secs: number | undefined;
  increment_secs: number | undefined;
  byoyomi_time_secs: number | undefined;
  byoyomi_periods: number | undefined;
  is_private: boolean;
};

// Baked into the #game element dataset as JSON on initial render
export type InitialGameProps = {
  state: GameState;
  black: UserData | null;
  white: UserData | null;
  komi: number;
  stage: GameStage;
  settings: GameSettings;
};

export type ClockData = {
  type: "fischer" | "byoyomi" | "correspondence";
  black: { remaining_ms: number; periods: number };
  white: { remaining_ms: number; periods: number };
  active_stone: number | null;
};

export type StateMessage = {
  kind: "state";
  stage: GameStage;
  state: GameState;
  negotiations?: Record<string, unknown>;
  current_turn_stone: number | null;
  moves: TurnData[];
  black: UserData | null;
  white: UserData | null;
  result: string | null;
  undo_rejected: boolean;
  allow_undo?: boolean;
  territory?: TerritoryData;
  score?: ScoreData;
  clock?: ClockData;
  online_users?: number[];
};

export type PresenceMessage = {
  kind: "presence";
  player_id: number;
  online: boolean;
};

export type ChatMessage = {
  kind: "chat";
  player_id?: number;
  text: string;
  move_number?: number;
  sent_at?: string;
};

export type ErrorMessage = {
  kind: "error";
  message: string;
};

export type UndoAcceptedMessage = {
  kind: "undo_accepted";
  state?: GameState;
  current_turn_stone?: number | null;
  moves?: TurnData[];
  undo_rejected?: boolean;
};

export type UndoRejectedMessage = {
  kind: "undo_rejected";
  state?: GameState;
  current_turn_stone?: number | null;
  moves?: TurnData[];
  undo_rejected?: boolean;
};

export type UndoRequestSentMessage = {
  kind: "undo_request_sent";
};

export type UndoResponseNeededMessage = {
  kind: "undo_response_needed";
  requesting_user: string;
};

export type IncomingMessage =
  | StateMessage
  | ChatMessage
  | ErrorMessage
  | PresenceMessage
  | UndoAcceptedMessage
  | UndoRejectedMessage
  | UndoRequestSentMessage
  | UndoResponseNeededMessage;
