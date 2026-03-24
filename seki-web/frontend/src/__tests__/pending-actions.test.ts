import { beforeEach, describe, expect, it, vi } from "vitest";
import { batch } from "@preact/signals";
import { handleGameMessage } from "../game/messages";
import type { GameMessageDeps } from "../game/messages";
import { GameStage, type GameState } from "../game/types";
import {
  allowUndo,
  black,
  clearGameFlashMessage,
  clearPendingAction,
  currentTurn,
  gameFlashMessage,
  gameStage,
  pendingAction,
  playerStone,
  result,
  setPendingAction,
  territory,
  undoRequest,
  white,
} from "../game/state";

const defaultState: GameState = {
  board: Array(361).fill(0),
  cols: 19,
  rows: 19,
  captures: { black: 0, white: 0 },
};

function buildDeps(): GameMessageDeps {
  return {
    gobanEl: () => null,
    clockState: {
      data: undefined,
      syncedAt: 0,
      interval: undefined,
      timeoutFlagSent: false,
    },
    territoryCountdown: {
      deadline: undefined,
      interval: undefined,
      flagSent: false,
      chatEntry: undefined,
    },
    channel: {
      play: () => {},
      pass: () => {},
      resign: () => {},
      toggleChain: () => {},
      say: () => {},
      requestUndo: () => {},
      acceptUndo: () => {},
      rejectUndo: () => {},
      approveTerritory: () => {},
      abort: () => {},
      claimVictory: () => {},
      acceptChallenge: () => {},
      declineChallenge: () => {},
      timeoutFlag: () => {},
      territoryTimeoutFlag: () => {},
      startPresentation: () => {},
      endPresentation: () => {},
      sendPresentationState: () => {},
      giveControl: () => {},
      takeControl: () => {},
      requestControl: () => {},
      cancelControlRequest: () => {},
      rejectControlRequest: () => {},
    },
    pendingMove: {
      value: undefined,
      enabled: false,
      getGhostStone: () => undefined,
      clear: vi.fn(),
    },
    notificationState: {
      lastNotifiedMoveCount: 0,
    },
  };
}

function resetSignals() {
  batch(() => {
    gameStage.value = GameStage.Unstarted;
    currentTurn.value = null;
    playerStone.value = 0;
    allowUndo.value = false;
    undoRequest.value = "none";
    pendingAction.value = undefined;
    gameFlashMessage.value = undefined;
    result.value = null;
    territory.value = undefined;
    black.value = undefined;
    white.value = undefined;
  });
}

beforeEach(() => {
  resetSignals();
});

describe("pending action state helpers", () => {
  it("only allows one pending action at a time", () => {
    expect(setPendingAction("pass")).toBe(true);
    expect(setPendingAction("request-undo")).toBe(false);
    expect(pendingAction.value).toBe("pass");

    clearPendingAction("pass");

    expect(setPendingAction("request-undo")).toBe(true);
    expect(pendingAction.value).toBe("request-undo");
  });
});

describe("pending action reconciliation", () => {
  it("clears undo request pending state when the server confirms the request", () => {
    setPendingAction("request-undo");

    handleGameMessage({ kind: "undo_request_sent" }, buildDeps());

    expect(pendingAction.value).toBeUndefined();
    expect(undoRequest.value).toBe("sent");
  });

  it("clears undo response pending state on undo acceptance", () => {
    setPendingAction("respond-undo-accept");

    handleGameMessage({ kind: "undo_accepted" }, buildDeps());

    expect(pendingAction.value).toBeUndefined();
  });

  it("clears pass pending state from authoritative turn change", () => {
    batch(() => {
      gameStage.value = GameStage.BlackToPlay;
      currentTurn.value = 1;
      playerStone.value = 1;
    });
    setPendingAction("pass");

    handleGameMessage(
      {
        kind: "state",
        stage: GameStage.WhiteToPlay,
        state: defaultState,
        current_turn_stone: -1,
        moves: [{ kind: "pass", stone: 1, pos: null }],
        black: null,
        white: null,
        result: null,
        undo_rejected: false,
      },
      buildDeps(),
    );

    expect(pendingAction.value).toBeUndefined();
  });

  it("clears territory pending state once the player's approval is authoritative", () => {
    batch(() => {
      gameStage.value = GameStage.TerritoryReview;
      playerStone.value = 1;
    });
    setPendingAction("accept-territory");

    handleGameMessage(
      {
        kind: "state",
        stage: GameStage.TerritoryReview,
        state: defaultState,
        current_turn_stone: null,
        moves: [],
        black: null,
        white: null,
        result: null,
        undo_rejected: false,
        territory: {
          ownership: Array(361).fill(0),
          dead_stones: [],
          score: {
            black: { territory: 0, captures: 0 },
            white: { territory: 0, captures: 0 },
          },
          black_approved: true,
          white_approved: false,
        },
      },
      buildDeps(),
    );

    expect(pendingAction.value).toBeUndefined();
  });

  it("clears pending state and sets a flash message on error", () => {
    setPendingAction("abort");
    clearGameFlashMessage();

    handleGameMessage(
      { kind: "error", message: "Request failed" },
      buildDeps(),
    );

    expect(pendingAction.value).toBeUndefined();
    expect(gameFlashMessage.value).toBe("Request failed");
  });

  it("clears stale pending state on websocket reconnect", () => {
    setPendingAction("start-presentation");

    handleGameMessage({ kind: "ws_reconnected", game_id: 7 }, buildDeps());

    expect(pendingAction.value).toBeUndefined();
  });
});
