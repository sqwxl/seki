// Keep in sync with go-engine Stage enum (go-engine/src/engine.rs)
export enum GameStage {
  Unstarted = "unstarted",
  Challenge = "challenge",
  BlackToPlay = "black_to_play",
  WhiteToPlay = "white_to_play",
  TerritoryReview = "territory_review",
  Completed = "completed",
  Aborted = "aborted",
  Declined = "declined",
}

export function isPlayStage(stage: GameStage): boolean {
  return stage === GameStage.BlackToPlay || stage === GameStage.WhiteToPlay;
}

export type Captures = {
  black: number;
  white: number;
};

// Keep in sync with go-engine GameState (go-engine/src/engine.rs)
export type GameState = {
  board: number[];
  cols: number;
  rows: number;
  captures: Captures;
  ko?: { pos: [number, number]; illegal: number } | null;
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

export type UserPreferences = {
  theme?: string;
  move_confirmation?: boolean;
  show_coordinates?: boolean;
  show_move_tree?: boolean;
  notifications?: string;
  notify_your_turn_app?: boolean;
  notify_your_turn_email?: boolean;
  notify_your_turn_corr_app?: boolean;
  notify_your_turn_corr_email?: boolean;
  notify_challenge_app?: boolean;
  notify_challenge_email?: boolean;
  notify_message_app?: boolean;
  notify_message_email?: boolean;
};

export type UserData = {
  id: number;
  display_name: string;
  is_registered: boolean;
  email?: string;
  preferences: UserPreferences;
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
  expires_at?: string;
};

export type SettledTerritoryData = {
  ownership: number[];
  dead_stones: [number, number][];
  score: ScoreData;
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
  invite_only: boolean;
};

// Baked into the #game element dataset as JSON on initial render
export type InitialGameProps = {
  state: GameState;
  creator_id: number | undefined;
  black: UserData | null;
  white: UserData | null;
  komi: number;
  stage: GameStage;
  settings: GameSettings;
  moves: TurnData[];
  current_turn_stone: number;
  result: string | null;
  settled_territory?: SettledTerritoryData;
  nigiri?: boolean;
  has_valid_access_token?: boolean;
  access_token?: string;
  can_start_presentation?: boolean;
};

export type ClockData = {
  type: "fischer" | "byoyomi" | "correspondence";
  black: { remaining_ms: number; periods: number };
  white: { remaining_ms: number; periods: number };
  active_stone: number | null;
  server_now_ms?: number;
};

export type StateMessage = {
  kind: "state" | "state_sync";
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
  nigiri?: boolean;
  territory?: TerritoryData;
  settled_territory?: SettledTerritoryData;
  clock?: ClockData;
  can_start_presentation?: boolean;
};

export type PresenceChangedMessage = {
  kind: "presence_changed";
  user_id: number;
  online: boolean;
};

export type PresenceStateMessage = {
  kind: "presence_state";
  users: Record<string, boolean>;
};

export type ChatMessage = {
  kind: "chat";
  player_id?: number;
  display_name?: string;
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
  clock?: ClockData;
};

export type UndoRejectedMessage = {
  kind: "undo_rejected";
  state?: GameState;
  current_turn_stone?: number | null;
  moves?: TurnData[];
  undo_rejected?: boolean;
  clock?: ClockData;
};

export type UndoRequestSentMessage = {
  kind: "undo_request_sent";
};

export type UndoResponseNeededMessage = {
  kind: "undo_response_needed";
  requesting_user: string;
};

export type PlayerDisconnectedMessage = {
  kind: "player_disconnected";
  user_id: number;
  timestamp: string;
  grace_period_ms?: number;
};

export type PlayerReconnectedMessage = {
  kind: "player_reconnected";
  user_id: number;
};

export type PlayerGoneMessage = {
  kind: "player_gone";
  user_id: number;
};

export type PresentationSnapshot = {
  tree: string;
  activeNodeId: string;
  territory?: {
    ownership: number[];
    deadStones: number[];
    score: { black: number; white: number };
  };
};

export type PresentationStartedMessage = {
  kind: "presentation_started";
  game_id: number;
  presenter_id: number;
  originator_id: number;
  snapshot: string;
  control_request?: { user_id: number; display_name: string };
};

export type PresentationEndedMessage = {
  kind: "presentation_ended";
  game_id: number;
};

export type PresentationUpdateMessage = {
  kind: "presentation_update";
  game_id: number;
  snapshot: string;
};

export type ControlChangedMessage = {
  kind: "control_changed";
  game_id: number;
  presenter_id: number;
};

export type ControlRequestedMessage = {
  kind: "control_requested";
  game_id: number;
  user_id: number;
  display_name: string;
};

export type ControlRequestCancelledMessage = {
  kind: "control_request_cancelled";
  game_id: number;
};

export type IncomingMessage =
  | StateMessage
  | ChatMessage
  | ErrorMessage
  | UndoAcceptedMessage
  | UndoRejectedMessage
  | UndoRequestSentMessage
  | UndoResponseNeededMessage
  | PlayerDisconnectedMessage
  | PlayerReconnectedMessage
  | PlayerGoneMessage
  | PresentationStartedMessage
  | PresentationEndedMessage
  | PresentationUpdateMessage
  | ControlChangedMessage
  | ControlRequestedMessage
  | ControlRequestCancelledMessage
  | { kind: "ws_reconnected"; game_id: number }
  | { kind: "ws_disconnected"; game_id: number };
