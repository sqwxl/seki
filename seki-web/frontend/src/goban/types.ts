import type { CSSProperties } from "preact";

export type Sign = 0 | 1 | -1;
export type Position = [number, number];
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
  v1: Position;
  v2: Position;
  type?: string;
};

export type VertexEventHandler = (evt: Event, position: Position) => void;

export type GobanProps = {
  id?: string;
  class?: string;
  className?: string;
  innerProps?: Record<string, unknown> & {
    ref?: (el: HTMLElement | null) => void;
  };
  style?: CSSProperties;
  vertexSize?: number;
  coordX?: (i: number) => string;
  coordY?: (i: number) => number | string;
  busy?: boolean;
  signMap: number[][];
  paintMap?: (number | null)[][];
  heatMap?: (HeatData | null)[][];
  markerMap?: (MarkerData | null)[][];
  ghostStoneMap?: (GhostStoneData | null)[][];
  fuzzyStonePlacement?: boolean;
  showCoordinates?: boolean;
  animateStonePlacement?: boolean;
  animationDuration?: number;
  lines?: LineData[];
  selectedVertices?: Position[];
  dimmedVertices?: Position[];
  rangeX?: [number, number];
  rangeY?: [number, number];
  onVertexClick?: VertexEventHandler;
};

export type BoundedGobanProps = GobanProps & {
  maxWidth: number;
  maxHeight: number;
  maxVertexSize?: number;
  onResized?: () => void;
};

// Keep in sync with go-engine Stage enum (go-engine/src/engine.rs)
export type GameStage = "unstarted" | "play" | "territory_review" | "done";

// WebSocket message types

export type GameState = {
  board: number[][];
  ko: { pos: [number, number]; stone: number } | null;
};

export type StateMessage = {
  kind: "state";
  stage: GameStage;
  state: GameState;
  negotiations?: Record<string, unknown>;
  current_turn_stone: number | null;
};

export type ChatMessage = {
  kind: "chat";
  sender: string;
  text: string;
};

export type ErrorMessage = {
  kind: "error";
  message: string;
};

export type UndoAcceptedMessage = {
  kind: "undo_accepted";
  message: string;
  stage?: GameStage;
  state?: GameState;
  current_turn_stone?: number | null;
};

export type UndoRejectedMessage = {
  kind: "undo_rejected";
  message: string;
  stage?: GameStage;
  state?: GameState;
  current_turn_stone?: number | null;
};

export type UndoRequestSentMessage = {
  kind: "undo_request_sent";
  message: string;
};

export type UndoResponseNeededMessage = {
  kind: "undo_response_needed";
  requesting_player: string;
  message: string;
};

export type IncomingMessage =
  | StateMessage
  | ChatMessage
  | ErrorMessage
  | UndoAcceptedMessage
  | UndoRejectedMessage
  | UndoRequestSentMessage
  | UndoResponseNeededMessage;
