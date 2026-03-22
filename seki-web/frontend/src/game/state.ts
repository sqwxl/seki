import { signal, computed, batch } from "@preact/signals";
import type {
  GameState,
  GameStage,
  InitialGameProps,
  UserData,
  SettledTerritoryData,
  TerritoryData,
  TurnData,
  ScoreData,
  StateMessage,
  UndoAcceptedMessage,
  UndoRejectedMessage,
  PresentationStartedMessage,
} from "./types";
import { GameStage as GS, isPlayStage } from "./types";
import type { Board } from "../goban/create-board";
import type { ChatEntry } from "../components/chat";
import type { Point } from "../goban/types";
import { storage, SHOW_MOVE_TREE, SHOW_COORDINATES } from "../utils/storage";
import { readMoveConfirmation } from "../utils/move-confirm";

// ---------------------------------------------------------------------------
// Config signals (set once at page load)
// ---------------------------------------------------------------------------
export const gameId = signal(0);
export const playerStone = signal(0);
export const initialProps = signal<InitialGameProps>({
  state: { board: [], cols: 0, rows: 0, captures: { black: 0, white: 0 } },
  creator_id: undefined,
  black: null,
  white: null,
  komi: 6.5,
  stage: GS.Unstarted,
  settings: {
    cols: 19,
    rows: 19,
    handicap: 0,
    time_control: "none",
    main_time_secs: undefined,
    increment_secs: undefined,
    byoyomi_time_secs: undefined,
    byoyomi_periods: undefined,
    is_private: false,
    invite_only: false,
  },
  moves: [],
  current_turn_stone: 0,
  result: null,
});

// ---------------------------------------------------------------------------
// Core game state (updated by WS messages)
// ---------------------------------------------------------------------------
export const gameState = signal<GameState>({
  board: [],
  cols: 0,
  rows: 0,
  captures: { black: 0, white: 0 },
});
export const gameStage = signal<GameStage>(GS.Unstarted);
export const currentTurn = signal<number | null>(null);
export const moves = signal<TurnData[]>([]);
export const black = signal<UserData | undefined>(undefined);
export const white = signal<UserData | undefined>(undefined);
export const result = signal<string | null>(null);
export const territory = signal<TerritoryData | undefined>(undefined);
export const settledTerritory = signal<SettledTerritoryData | undefined>(
  undefined,
);
export const onlineUsers = signal<Map<number, UserData>>(new Map());
export const nigiri = signal(false);
export type UndoRequestState = "none" | "sent" | "received" | "rejected";
export const undoRequest = signal<UndoRequestState>("none");
export const allowUndo = signal(false);
export const opponentDisconnected = signal<
  { since: Date; gracePeriodMs?: number; gone: boolean } | undefined
>(undefined);

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------
export const chatMessages = signal<ChatEntry[]>([]);
export const hasUnreadChat = signal(false);
export const pendingMove = signal<Point | undefined>(undefined);
export const uiNowMs = signal(Date.now());

// ---------------------------------------------------------------------------
// UI mode flags
// ---------------------------------------------------------------------------
export const mobileTab = signal<"board" | "chat" | "analysis">("board");

// analysisMode and estimateMode are derived from gamePhase (see below)

// ---------------------------------------------------------------------------
// Presentation state (post-game collaborative analysis)
// ---------------------------------------------------------------------------
export const currentUserId = signal(0);
export const canStartPresentation = signal(false);
export const presentationActive = signal(false);
export const presenterId = signal(0);
export const originatorId = signal(0);
export const controlRequest = signal<
  { userId: number; displayName: string } | undefined
>(undefined);

// ---------------------------------------------------------------------------
// Board reference (async, set after WASM loads)
// ---------------------------------------------------------------------------
export const board = signal<Board | undefined>(undefined);

// ---------------------------------------------------------------------------
// Nav / estimate state (updated by board callbacks)
// ---------------------------------------------------------------------------
export const navState = signal({
  atStart: true,
  atLatest: true,
  atMainEnd: true,
  counter: "0",
  boardTurnStone: 1,
  boardLastMoveWasPass: false,
});
export const estimateScore = signal<ScoreData | undefined>(undefined);
export const boardFinalized = signal(false);
export const boardFinalizedScore = signal<ScoreData | undefined>(undefined);
export const boardReviewing = signal(false);
export const showMoveTree = signal(storage.get(SHOW_MOVE_TREE) === "true");
export const showCoordinates = signal(storage.get(SHOW_COORDINATES) === "true");
export const moveConfirmEnabled = signal(readMoveConfirmation());

// ---------------------------------------------------------------------------
// Derived (computed)
// ---------------------------------------------------------------------------
export const isMyTurn = computed(
  () =>
    playerStone.value !== 0 &&
    currentTurn.value === playerStone.value &&
    isPlayStage(gameStage.value),
);

export const isPlayer = computed(() => playerStone.value !== 0);

export const isPresenter = computed(
  () => presentationActive.value && presenterId.value === currentUserId.value,
);

export const isOriginator = computed(
  () => presentationActive.value && originatorId.value === currentUserId.value,
);

export const presenterDisplayName = computed(() => {
  if (!presentationActive.value) {
    return "";
  }
  const user = onlineUsers.value.get(presenterId.value);
  return user?.display_name ?? "";
});

// ---------------------------------------------------------------------------
// Action functions — all signal mutations go through these
// ---------------------------------------------------------------------------

/** Called once at page load to set config signals. */
export function initGameState(
  id: number,
  userId: number,
  stone: number,
  props: InitialGameProps,
): void {
  batch(() => {
    gameId.value = id;
    currentUserId.value = userId;
    playerStone.value = stone;
    initialProps.value = props;
    gameState.value = props.state;
    gameStage.value = props.stage;
    currentTurn.value = props.current_turn_stone;
    moves.value = props.moves ?? [];
    result.value = props.result;
    settledTerritory.value = props.settled_territory;
    nigiri.value = props.nigiri ?? false;
    canStartPresentation.value = props.can_start_presentation ?? false;
    black.value = props.black ?? undefined;
    white.value = props.white ?? undefined;
  });
}

/** Reset route-scoped runtime state that previously relied on a full page load. */
export function resetGameRuntimeState(): void {
  batch(() => {
    territory.value = undefined;
    settledTerritory.value = undefined;
    onlineUsers.value = new Map();
    nigiri.value = false;
    undoRequest.value = "none";
    allowUndo.value = false;
    opponentDisconnected.value = undefined;
    chatMessages.value = [];
    hasUnreadChat.value = false;
    pendingMove.value = undefined;
    uiNowMs.value = Date.now();
    canStartPresentation.value = false;
    presentationActive.value = false;
    presenterId.value = 0;
    originatorId.value = 0;
    controlRequest.value = undefined;
    board.value = undefined;
    navState.value = {
      atStart: true,
      atLatest: true,
      atMainEnd: true,
      counter: "0",
      boardTurnStone: 1,
      boardLastMoveWasPass: false,
    };
    estimateScore.value = undefined;
    boardFinalized.value = false;
    boardFinalizedScore.value = undefined;
    boardReviewing.value = false;
    mobileTab.value = "board";
  });
}

// Track territory approval for chat messages (local to this module)
let _prevBlackApproved = false;
let _prevWhiteApproved = false;

/** Called from WS "state" message handler. Uses batch() for atomic update. */
export function applyGameStateMessage(data: StateMessage): void {
  const approvalMessages: ChatEntry[] = [];
  if (data.territory) {
    if (data.territory.black_approved && !_prevBlackApproved) {
      approvalMessages.push({ text: "Black accepted the score" });
    }
    if (data.territory.white_approved && !_prevWhiteApproved) {
      approvalMessages.push({ text: "White accepted the score" });
    }
    _prevBlackApproved = data.territory.black_approved;
    _prevWhiteApproved = data.territory.white_approved;
  }

  batch(() => {
    gameState.value = data.state;
    gameStage.value = data.stage;
    currentTurn.value = data.current_turn_stone;
    moves.value = data.moves ?? [];
    // Server undo_rejected resets per-move; sync local undo state.
    // Always dismiss on game end so the popover doesn't linger.
    if (data.result) {
      undoRequest.value = "none";
    } else if (data.undo_rejected) {
      undoRequest.value = "rejected";
    } else if (undoRequest.value !== "received") {
      undoRequest.value = "none";
    }
    allowUndo.value = data.allow_undo ?? false;
    if (data.nigiri !== undefined) {
      nigiri.value = data.nigiri;
    }
    result.value = data.result;
    territory.value = data.territory;
    settledTerritory.value = data.settled_territory;
    if (data.can_start_presentation != null) {
      canStartPresentation.value = data.can_start_presentation;
    }
    black.value = data.black ?? undefined;
    white.value = data.white ?? undefined;
    // Re-derive playerStone from updated black/white (nigiri swap may have changed them)
    if (currentUserId.value) {
      if (data.black?.id === currentUserId.value) {
        playerStone.value = 1;
      } else if (data.white?.id === currentUserId.value) {
        playerStone.value = -1;
      }
    }
    if (approvalMessages.length > 0) {
      chatMessages.value = [...chatMessages.value, ...approvalMessages];
    }
  });
}

/** Called from WS undo_accepted/undo_rejected handlers. */
export function applyUndo(
  data: UndoAcceptedMessage | UndoRejectedMessage,
): void {
  batch(() => {
    undoRequest.value =
      data.undo_rejected !== undefined && data.undo_rejected
        ? "rejected"
        : "none";
    if (data.state) {
      gameState.value = data.state;
      currentTurn.value = data.current_turn_stone ?? null;
      if (data.moves) {
        moves.value = data.moves;
      }
    }
  });
}

/** Append a chat entry (immutable). */
export function addChatMessage(entry: ChatEntry): void {
  chatMessages.value = [...chatMessages.value, entry];
  if (entry.user_id != null && mobileTab.value !== "chat") {
    hasUnreadChat.value = true;
  }
}

/** Replace a chat entry's text (immutable). */
export function updateChatEntry(old: ChatEntry, updated: ChatEntry): void {
  chatMessages.value = chatMessages.value.map((e) => (e === old ? updated : e));
}

/** Remove a chat entry (immutable). */
export function removeChatEntry(entry: ChatEntry): void {
  chatMessages.value = chatMessages.value.filter((e) => e !== entry);
}

/** Update online user presence. */
export function setPresence(
  userId: number,
  online: boolean,
  user?: UserData,
): void {
  const next = new Map(onlineUsers.value);
  if (online && user) {
    next.set(userId, user);
  } else {
    next.delete(userId);
  }
  onlineUsers.value = next;
}

/** Called when a presentation starts (from WS message). */
export function applyPresentationStarted(
  data: PresentationStartedMessage,
): void {
  batch(() => {
    presentationActive.value = true;
    canStartPresentation.value = false;
    presenterId.value = data.presenter_id;
    originatorId.value = data.originator_id;
    if (data.control_request) {
      controlRequest.value = {
        userId: data.control_request.user_id,
        displayName: data.control_request.display_name,
      };
    }
  });
}

/** Called when a presentation ends (from WS message). */
export function clearPresentation(): void {
  batch(() => {
    presentationActive.value = false;
    presenterId.value = 0;
    originatorId.value = 0;
    controlRequest.value = undefined;
    // After a session ends, has_had_presentation is true server-side,
    // so any connected user on a finished game is now eligible
    if (result.value) {
      canStartPresentation.value = true;
    }
  });
}

// Re-export phase for convenience
export { gamePhase, analysisMode, estimateMode } from "./phase";
export type { GamePhase } from "./phase";
