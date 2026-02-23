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
} from "../goban/types";
import { GameStage as GS, isPlayStage } from "../goban/types";
import type { Board } from "../goban/create-board";
import type { ChatEntry } from "../components/chat";
import {
  storage,
  SHOW_MOVE_TREE,
  MOVE_CONFIRMATION,
} from "../utils/storage";

// ---------------------------------------------------------------------------
// Config signals (set once at page load)
// ---------------------------------------------------------------------------
export const gameId = signal(0);
export const playerStone = signal(0);
export const initialProps = signal<InitialGameProps>(undefined!);

// ---------------------------------------------------------------------------
// Core game state (updated by WS messages)
// ---------------------------------------------------------------------------
export const gameState = signal<GameState>(undefined!);
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
export const onlineUsers = signal<Set<number>>(new Set());
export const undoRejected = signal(false);
export const allowUndo = signal(false);

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------
export const chatMessages = signal<ChatEntry[]>([]);

// ---------------------------------------------------------------------------
// UI mode flags
// ---------------------------------------------------------------------------
export const analysisMode = signal(false);
export const estimateMode = signal(false);
export const undoResponseNeeded = signal(false);

// ---------------------------------------------------------------------------
// Board reference (async, set after WASM loads)
// ---------------------------------------------------------------------------
export const board = signal<Board | undefined>(undefined);

// ---------------------------------------------------------------------------
// Nav / estimate state (updated by board callbacks)
// ---------------------------------------------------------------------------
export const navState = signal({ atStart: true, atLatest: true, counter: "0" });
export const estimateScore = signal<ScoreData | undefined>(undefined);
export const showMoveTree = signal(
  storage.get(SHOW_MOVE_TREE) === "true",
);
export const moveConfirmEnabled = signal(
  storage.get(MOVE_CONFIRMATION) === "true",
);

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

// ---------------------------------------------------------------------------
// Action functions — all signal mutations go through these
// ---------------------------------------------------------------------------

/** Called once at page load to set config signals. */
export function initGameState(
  id: number,
  stone: number,
  props: InitialGameProps,
): void {
  batch(() => {
    gameId.value = id;
    playerStone.value = stone;
    initialProps.value = props;
    gameState.value = props.state;
    gameStage.value = props.stage;
    currentTurn.value = props.current_turn_stone;
    moves.value = props.moves ?? [];
    result.value = props.result;
    settledTerritory.value = props.settled_territory;
    black.value = props.black ?? undefined;
    white.value = props.white ?? undefined;
  });
}

// Track territory approval for chat messages (local to this module)
let _prevBlackApproved = false;
let _prevWhiteApproved = false;

/** Called from WS "state" message handler. Uses batch() for atomic update. */
export function applyGameState(data: {
  state: GameState;
  stage: GameStage;
  current_turn_stone: number | null;
  moves: TurnData[];
  undo_rejected: boolean;
  allow_undo?: boolean;
  result: string | null;
  territory?: TerritoryData;
  settled_territory?: SettledTerritoryData;
  black: UserData | null;
  white: UserData | null;
  online_users?: number[];
}): { prevBlack: UserData | undefined; prevWhite: UserData | undefined } {
  const prevBlack = black.value;
  const prevWhite = white.value;

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
    undoRejected.value = data.undo_rejected;
    allowUndo.value = data.allow_undo ?? false;
    result.value = data.result;
    territory.value = data.territory;
    settledTerritory.value = data.settled_territory;
    black.value = data.black ?? undefined;
    white.value = data.white ?? undefined;
    if (data.online_users) {
      onlineUsers.value = new Set(data.online_users);
    }
    if (approvalMessages.length > 0) {
      chatMessages.value = [...chatMessages.value, ...approvalMessages];
    }
  });

  return { prevBlack, prevWhite };
}

/** Called from WS undo_accepted/undo_rejected handlers. */
export function applyUndo(data: {
  state?: GameState;
  current_turn_stone?: number | null;
  moves?: TurnData[];
  undo_rejected?: boolean;
}): void {
  batch(() => {
    undoResponseNeeded.value = false;
    if (data.undo_rejected !== undefined) {
      undoRejected.value = data.undo_rejected;
    }
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
}

/** Replace a chat entry's text (immutable). */
export function updateChatEntry(old: ChatEntry, updated: ChatEntry): void {
  chatMessages.value = chatMessages.value.map((e) =>
    e === old ? updated : e,
  );
}

/** Remove a chat entry (immutable). */
export function removeChatEntry(entry: ChatEntry): void {
  chatMessages.value = chatMessages.value.filter((e) => e !== entry);
}

/** Update online user presence. */
export function setPresence(userId: number, online: boolean): void {
  const next = new Set(onlineUsers.value);
  if (online) {
    next.add(userId);
  } else {
    next.delete(userId);
  }
  onlineUsers.value = next;
}
