import type { CSSProperties } from "preact";

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
export type GameStage = "unstarted" | "play" | "territory_review" | "done";

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
  stage: GameStage;
};

export type TurnData = {
  kind: "play" | "pass" | "resign";
  stone: number;
  pos: [number, number] | null;
};

export type PlayerData = {
  id: number;
  display_name: string;
  is_registered: boolean;
};

// Baked into the #game element dataset as JSON on initial render
export type InitialGameProps = {
  state: GameState;
  black: PlayerData | null;
  white: PlayerData | null;
};

export type StateMessage = {
  kind: "state";
  stage: GameStage;
  state: GameState;
  negotiations?: Record<string, unknown>;
  current_turn_stone: number | null;
  moves: TurnData[];
  black: PlayerData | null;
  white: PlayerData | null;
  result: string | null;
  description: string;
  undo_rejected: boolean;
};

export type ChatMessage = {
  kind: "chat";
  sender: string;
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
  description?: string;
  undo_rejected?: boolean;
};

export type UndoRejectedMessage = {
  kind: "undo_rejected";
  state?: GameState;
  current_turn_stone?: number | null;
  moves?: TurnData[];
  description?: string;
  undo_rejected?: boolean;
};

export type UndoRequestSentMessage = {
  kind: "undo_request_sent";
};

export type UndoResponseNeededMessage = {
  kind: "undo_response_needed";
  requesting_player: string;
};

export type IncomingMessage =
  | StateMessage
  | ChatMessage
  | ErrorMessage
  | UndoAcceptedMessage
  | UndoRejectedMessage
  | UndoRequestSentMessage
  | UndoResponseNeededMessage;
