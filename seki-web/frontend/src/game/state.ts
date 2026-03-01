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
import { storage, SHOW_MOVE_TREE } from "../utils/storage";
import { readMoveConfirmation } from "../utils/premove";

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
export const undoRejected = signal(false);
export const allowUndo = signal(false);
export const opponentDisconnected = signal<{ since: Date } | undefined>(
  undefined,
);

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
// Presentation state (post-game collaborative analysis)
// ---------------------------------------------------------------------------
export const currentUserId = signal(0);
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
export const navState = signal({ atStart: true, atLatest: true, atMainEnd: true, counter: "0" });
export const estimateScore = signal<ScoreData | undefined>(undefined);
export const showMoveTree = signal(storage.get(SHOW_MOVE_TREE) === "true");
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
    black.value = props.black ?? undefined;
    white.value = props.white ?? undefined;
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
    undoRejected.value = data.undo_rejected;
    allowUndo.value = data.allow_undo ?? false;
    result.value = data.result;
    territory.value = data.territory;
    settledTerritory.value = data.settled_territory;
    black.value = data.black ?? undefined;
    white.value = data.white ?? undefined;
    if (data.online_users) {
      const map = new Map<number, UserData>();
      for (const u of data.online_users) {
        map.set(u.id, u);
      }
      onlineUsers.value = map;
      // Reconcile: clear disconnect signal if opponent is back online
      if (opponentDisconnected.value) {
        const oppId =
          playerStone.value === 1 ? white.value?.id : black.value?.id;
        if (oppId != null && map.has(oppId)) {
          opponentDisconnected.value = undefined;
        }
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
export function applyPresentationStarted(data: PresentationStartedMessage): void {
  batch(() => {
    presentationActive.value = true;
    presenterId.value = data.presenter_id;
    originatorId.value = data.originator_id;
    if (data.control_request != null) {
      // We don't have the display name for late joiners, but the signal will
      // be updated if a new control_requested message comes in.
      controlRequest.value = {
        userId: data.control_request,
        displayName: "",
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
  });
}
