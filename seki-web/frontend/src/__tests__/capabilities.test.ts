import { describe, it, expect, beforeEach, vi } from "vitest";
import { batch } from "@preact/signals";
import { GameStage } from "../game/types";
import type {
  GameState,
  UserData,
  TerritoryData,
  SettledTerritoryData,
} from "../game/types";
import {
  resetPhase,
  toAnalysis,
  toEstimate,
  toPresentation,
  toPresentationLocalAnalysis,
} from "../game/phase";
import { liveGameCapabilities } from "../game/capabilities";
import {
  gameState,
  gameStage,
  currentTurn,
  moves,
  black,
  white,
  result,
  territory,
  settledTerritory,
  onlineUsers,
  undoRejected,
  allowUndo,
  opponentDisconnected,
  playerStone,
  initialProps,
  currentUserId,
  presenterId,
  originatorId,
  controlRequest,
  nigiri,
  navState,
  estimateScore,
  showMoveTree,
  moveConfirmEnabled,
  hasUnreadChat,
  presentationActive,
  canStartPresentation,
} from "../game/state";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const defaultState: GameState = {
  board: Array(361).fill(0),
  cols: 19,
  rows: 19,
  captures: { black: 0, white: 0 },
};

const userBlack: UserData = {
  id: 1,
  display_name: "Alice",
  is_registered: true,
  preferences: {},
};
const userWhite: UserData = {
  id: 2,
  display_name: "Bob",
  is_registered: true,
  preferences: {},
};

function resetAllSignals() {
  batch(() => {
    gameState.value = defaultState;
    gameStage.value = GameStage.Unstarted;
    currentTurn.value = null;
    moves.value = [];
    black.value = undefined;
    white.value = undefined;
    result.value = null;
    territory.value = undefined;
    settledTerritory.value = undefined;
    onlineUsers.value = new Map();
    undoRejected.value = false;
    allowUndo.value = false;
    opponentDisconnected.value = undefined;
    playerStone.value = 0;
    initialProps.value = {
      state: defaultState,
      creator_id: 1,
      black: null,
      white: null,
      komi: 6.5,
      stage: GameStage.Unstarted,
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
    };
    currentUserId.value = 0;
    presenterId.value = 0;
    originatorId.value = 0;
    controlRequest.value = undefined;
    nigiri.value = false;
    navState.value = {
      atStart: true,
      atLatest: true,
      atMainEnd: true,
      counter: "0",
    };
    estimateScore.value = undefined;
    showMoveTree.value = false;
    moveConfirmEnabled.value = false;
    hasUnreadChat.value = false;
    presentationActive.value = false;
    canStartPresentation.value = false;
  });
  resetPhase();
}

/** Set up a standard in-progress game where we are black and it's black's turn. */
function setupPlayingGame() {
  batch(() => {
    gameStage.value = GameStage.BlackToPlay;
    currentTurn.value = 1;
    black.value = userBlack;
    white.value = userWhite;
    playerStone.value = 1;
    currentUserId.value = 1;
    allowUndo.value = true;
  });
}

/** Set up a game where we are white and it's white's turn. */
function setupPlayingAsWhite() {
  batch(() => {
    gameStage.value = GameStage.WhiteToPlay;
    currentTurn.value = -1;
    black.value = userBlack;
    white.value = userWhite;
    playerStone.value = -1;
    currentUserId.value = 2;
    allowUndo.value = true;
  });
}

function caps() {
  return liveGameCapabilities.value;
}

// ---------------------------------------------------------------------------
beforeEach(() => {
  resetAllSignals();
});

// ===========================================================================
// 1. Spectator
// ===========================================================================
describe("spectator", () => {
  beforeEach(() => {
    batch(() => {
      gameStage.value = GameStage.BlackToPlay;
      currentTurn.value = 1;
      black.value = userBlack;
      white.value = userWhite;
      playerStone.value = 0; // spectator
      currentUserId.value = 99;
    });
  });

  it("cannot perform game actions", () => {
    expect(caps().canPass).toBe(false);
    expect(caps().canRequestUndo).toBe(false);
    expect(caps().canResign).toBe(false);
    expect(caps().canAbort).toBe(false);
    expect(caps().canAcceptTerritory).toBe(false);
    expect(caps().canPlayMove).toBe(false);
  });

  it("can join public game with open slot", () => {
    white.value = undefined; // open slot
    expect(caps().canJoinGame).toBe(true);
  });

  it("cannot join private game", () => {
    white.value = undefined;
    initialProps.value = {
      ...initialProps.value,
      settings: { ...initialProps.value.settings, is_private: true },
    };
    expect(caps().canJoinGame).toBe(false);
  });

  it("cannot join invite-only game", () => {
    white.value = undefined;
    initialProps.value = {
      ...initialProps.value,
      settings: { ...initialProps.value.settings, invite_only: true },
    };
    expect(caps().canJoinGame).toBe(false);
  });

  it("cannot join game with no open slots", () => {
    // Both slots filled (default)
    expect(caps().canJoinGame).toBe(false);
  });
});

// ===========================================================================
// 2. Pass
// ===========================================================================
describe("pass", () => {
  it("enabled on my turn", () => {
    setupPlayingGame();
    expect(caps().canPass).toBe(true);
    expect(caps().confirmPassRequired).toBe(true);
  });

  it("disabled on opponent turn", () => {
    setupPlayingGame();
    gameStage.value = GameStage.WhiteToPlay;
    currentTurn.value = -1;
    expect(caps().canPass).toBe(false);
  });

  it("disabled in estimate mode", () => {
    setupPlayingGame();
    toEstimate();
    expect(caps().canPass).toBe(false);
  });

  it("disabled during challenge", () => {
    setupPlayingGame();
    batch(() => {
      gameStage.value = GameStage.Challenge;
      currentTurn.value = null;
    });
    expect(caps().canPass).toBe(false);
  });

  it("passIsAnalysisPass in analysis mode", () => {
    setupPlayingGame();
    toAnalysis();
    expect(caps().passIsAnalysisPass).toBe(true);
    expect(caps().canPass).toBe(false); // real pass disabled
    expect(caps().confirmPassRequired).toBe(false);
  });

  it("passIsAnalysisPass on finished game in analysis", () => {
    setupPlayingGame();
    batch(() => {
      gameStage.value = GameStage.Completed;
      result.value = "B+R";
    });
    toAnalysis();
    expect(caps().passIsAnalysisPass).toBe(true);
  });
});

// ===========================================================================
// 3. Undo
// ===========================================================================
describe("undo", () => {
  it("enabled when opponent's turn and moves exist", () => {
    setupPlayingGame();
    batch(() => {
      // It's now white's turn (opponent moved)
      gameStage.value = GameStage.WhiteToPlay;
      currentTurn.value = -1;
      moves.value = [{ kind: "play", stone: 1, pos: [3, 3] }];
    });
    expect(caps().canRequestUndo).toBe(true);
    expect(caps().undoTooltip).toBe("Request to undo your last move");
  });

  it("disabled on your turn", () => {
    setupPlayingGame();
    moves.value = [{ kind: "play", stone: 1, pos: [3, 3] }];
    expect(caps().canRequestUndo).toBe(false);
    expect(caps().undoTooltip).toBe("Cannot undo on your turn");
  });

  it("disabled when no moves", () => {
    setupPlayingGame();
    batch(() => {
      gameStage.value = GameStage.WhiteToPlay;
      currentTurn.value = -1;
    });
    expect(caps().canRequestUndo).toBe(false);
    expect(caps().undoTooltip).toBe("No moves to undo");
  });

  it("disabled when rejected", () => {
    setupPlayingGame();
    batch(() => {
      gameStage.value = GameStage.WhiteToPlay;
      currentTurn.value = -1;
      moves.value = [{ kind: "play", stone: 1, pos: [3, 3] }];
      undoRejected.value = true;
    });
    expect(caps().canRequestUndo).toBe(false);
    expect(caps().undoTooltip).toBe("Undo was rejected for this move");
  });

  it("disabled during challenge", () => {
    setupPlayingGame();
    batch(() => {
      gameStage.value = GameStage.Challenge;
      currentTurn.value = null;
      moves.value = [{ kind: "play", stone: 1, pos: [3, 3] }];
    });
    expect(caps().canRequestUndo).toBe(false);
    expect(caps().undoTooltip).toBe("Challenge not yet accepted");
  });

  it("disabled in analysis mode", () => {
    setupPlayingGame();
    batch(() => {
      gameStage.value = GameStage.WhiteToPlay;
      currentTurn.value = -1;
      moves.value = [{ kind: "play", stone: 1, pos: [3, 3] }];
    });
    toAnalysis();
    expect(caps().canRequestUndo).toBe(false);
  });

  it("disabled in estimate mode", () => {
    setupPlayingGame();
    batch(() => {
      gameStage.value = GameStage.WhiteToPlay;
      currentTurn.value = -1;
      moves.value = [{ kind: "play", stone: 1, pos: [3, 3] }];
    });
    toEstimate();
    expect(caps().canRequestUndo).toBe(false);
  });

  it("hidden when undo not allowed (tooltip empty)", () => {
    setupPlayingGame();
    allowUndo.value = false;
    expect(caps().undoTooltip).toBe("");
  });
});

// ===========================================================================
// 4. Resign
// ===========================================================================
describe("resign", () => {
  it("enabled during play with moves", () => {
    setupPlayingGame();
    moves.value = [{ kind: "play", stone: 1, pos: [3, 3] }];
    expect(caps().canResign).toBe(true);
  });

  it("disabled before first move", () => {
    setupPlayingGame();
    expect(caps().canResign).toBe(false);
  });

  it("disabled during challenge", () => {
    setupPlayingGame();
    gameStage.value = GameStage.Challenge;
    expect(caps().canResign).toBe(false);
  });

  it("not available for spectator", () => {
    setupPlayingGame();
    playerStone.value = 0;
    expect(caps().canResign).toBe(false);
  });
});

// ===========================================================================
// 5. Abort
// ===========================================================================
describe("abort", () => {
  it("creator can abort during challenge", () => {
    batch(() => {
      gameStage.value = GameStage.Challenge;
      black.value = userBlack;
      white.value = userWhite;
      playerStone.value = 1; // we are black = creator (id 1)
      currentUserId.value = 1;
      initialProps.value = { ...initialProps.value, creator_id: 1 };
    });
    expect(caps().canAbort).toBe(true);
  });

  it("challengee cannot abort during challenge", () => {
    batch(() => {
      gameStage.value = GameStage.Challenge;
      black.value = userBlack;
      white.value = userWhite;
      playerStone.value = -1; // we are white = challengee
      currentUserId.value = 2;
      initialProps.value = { ...initialProps.value, creator_id: 1 };
    });
    expect(caps().canAbort).toBe(false);
  });

  it("either player can abort before first move after accept", () => {
    batch(() => {
      gameStage.value = GameStage.BlackToPlay;
      currentTurn.value = 1;
      black.value = userBlack;
      white.value = userWhite;
      playerStone.value = -1; // we are white (non-creator)
      currentUserId.value = 2;
      moves.value = []; // no moves yet
    });
    expect(caps().canAbort).toBe(true);
  });

  it("not available after first move", () => {
    setupPlayingGame();
    moves.value = [{ kind: "play", stone: 1, pos: [3, 3] }];
    expect(caps().canAbort).toBe(false);
  });

  it("not available after game done", () => {
    setupPlayingGame();
    batch(() => {
      gameStage.value = GameStage.Completed;
      result.value = "B+R";
    });
    expect(caps().canAbort).toBe(false);
  });
});

// ===========================================================================
// 6. Territory review
// ===========================================================================
describe("territory review", () => {
  const terrData: TerritoryData = {
    ownership: Array(361).fill(0),
    dead_stones: [],
    score: {
      black: { territory: 50, captures: 3 },
      white: { territory: 45, captures: 2 },
    },
    black_approved: false,
    white_approved: false,
  };

  function setupTerritoryReview() {
    batch(() => {
      gameStage.value = GameStage.TerritoryReview;
      black.value = userBlack;
      white.value = userWhite;
      playerStone.value = 1;
      currentUserId.value = 1;
      territory.value = terrData;
    });
  }

  it("accept enabled during review", () => {
    setupTerritoryReview();
    expect(caps().canAcceptTerritory).toBe(true);
    expect(caps().canToggleDeadStones).toBe(true);
  });

  it("disabled when black already approved (as black)", () => {
    setupTerritoryReview();
    territory.value = { ...terrData, black_approved: true };
    expect(caps().canAcceptTerritory).toBe(false);
  });

  it("disabled when white already approved (as white)", () => {
    setupTerritoryReview();
    batch(() => {
      playerStone.value = -1;
      currentUserId.value = 2;
      territory.value = { ...terrData, white_approved: true };
    });
    expect(caps().canAcceptTerritory).toBe(false);
  });

  it("black can still accept when only white approved", () => {
    setupTerritoryReview();
    territory.value = { ...terrData, white_approved: true };
    expect(caps().canAcceptTerritory).toBe(true);
  });

  it("disabled when opponent disconnected", () => {
    setupTerritoryReview();
    opponentDisconnected.value = { since: new Date(), gone: false };
    expect(caps().canAcceptTerritory).toBe(false);
  });

  it("produces territory overlay", () => {
    setupTerritoryReview();
    territory.value = {
      ...terrData,
      ownership: [1, -1, 0],
      dead_stones: [[2, 3]],
    };
    const overlay = caps().territoryOverlay;
    expect(overlay).toBeDefined();
    expect(overlay!.paintMap).toEqual([1, -1, null]);
    expect(overlay!.dimmedVertices).toEqual([[2, 3]]);
  });
});

// ===========================================================================
// 7. Navigation
// ===========================================================================
describe("navigation", () => {
  it("disabled for synced presentation viewer", () => {
    setupPlayingGame();
    batch(() => {
      gameStage.value = GameStage.Completed;
      result.value = "B+R";
      presentationActive.value = true;
      presenterId.value = 999;
      originatorId.value = 999;
    });
    toPresentation("synced-viewer");
    expect(caps().canNavigate).toBe(false);
  });

  it("enabled for presenter", () => {
    setupPlayingGame();
    batch(() => {
      gameStage.value = GameStage.Completed;
      result.value = "B+R";
      presentationActive.value = true;
      presenterId.value = 1;
      originatorId.value = 1;
      currentUserId.value = 1;
    });
    toPresentation("presenter");
    expect(caps().canNavigate).toBe(true);
  });

  it("enabled in live phase", () => {
    setupPlayingGame();
    expect(caps().canNavigate).toBe(true);
  });

  it("nav state reflects signal for non-viewer", () => {
    setupPlayingGame();
    navState.value = {
      atStart: false,
      atLatest: false,
      atMainEnd: true,
      counter: "5/10",
    };
    const nav = caps().nav;
    expect(nav.atStart).toBe(false);
    expect(nav.atLatest).toBe(false);
    expect(nav.counter).toBe("5/10");
  });

  it("nav state overridden for synced viewer", () => {
    batch(() => {
      gameStage.value = GameStage.Completed;
      result.value = "B+R";
      black.value = userBlack;
      white.value = userWhite;
      playerStone.value = 0;
      presentationActive.value = true;
      presenterId.value = 999;
      originatorId.value = 999;
    });
    toPresentation("synced-viewer");
    navState.value = {
      atStart: false,
      atLatest: false,
      atMainEnd: false,
      counter: "5/10",
    };
    const nav = caps().nav;
    expect(nav.atStart).toBe(true);
    expect(nav.atLatest).toBe(true);
    expect(nav.counter).toBe("5/10"); // counter is still passed through
  });
});

// ===========================================================================
// 8. Player panels
// ===========================================================================
describe("player panels", () => {
  it("opponent on top for black player", () => {
    setupPlayingGame(); // we are black
    expect(caps().topPanel.name).toBe("Bob"); // white on top
    expect(caps().bottomPanel.name).toBe("Alice"); // us (black) on bottom
  });

  it("opponent on top for white player", () => {
    setupPlayingAsWhite();
    expect(caps().topPanel.name).toBe("Alice"); // black on top
    expect(caps().bottomPanel.name).toBe("Bob"); // us (white) on bottom
  });

  it("nigiri stones when pending", () => {
    batch(() => {
      gameStage.value = GameStage.Unstarted;
      black.value = userBlack;
      white.value = userWhite;
      playerStone.value = 1;
      currentUserId.value = 1;
      nigiri.value = true;
    });
    expect(caps().topPanel.stone).toBe("nigiri");
    expect(caps().bottomPanel.stone).toBe("nigiri");
  });

  it("normal stones when nigiri resolved and game in play", () => {
    setupPlayingGame();
    nigiri.value = true; // nigiri flag still set, but game is in play
    expect(caps().topPanel.stone).toBe("white");
    expect(caps().bottomPanel.stone).toBe("black");
  });

  it("normal stones during territory review with nigiri flag", () => {
    setupPlayingGame();
    nigiri.value = true;
    gameStage.value = GameStage.TerritoryReview;
    expect(caps().topPanel.stone).toBe("white");
    expect(caps().bottomPanel.stone).toBe("black");
  });

  it("online status reflected", () => {
    setupPlayingGame();
    const online = new Map<number, UserData>();
    online.set(1, userBlack);
    onlineUsers.value = online;
    // Black is online, white is not
    expect(caps().bottomPanel.isOnline).toBe(true); // black (us) on bottom
    expect(caps().topPanel.isOnline).toBe(false); // white on top
  });
});

// ===========================================================================
// 9. Mode transitions
// ===========================================================================
describe("mode transitions", () => {
  it("canEnterAnalysis during play", () => {
    setupPlayingGame();
    expect(caps().canEnterAnalysis).toBe(true);
  });

  it("cannot enter analysis during territory review", () => {
    setupPlayingGame();
    gameStage.value = GameStage.TerritoryReview;
    expect(caps().canEnterAnalysis).toBe(false);
  });

  it("cannot enter analysis during presentation", () => {
    batch(() => {
      gameStage.value = GameStage.Completed;
      result.value = "B+R";
      black.value = userBlack;
      white.value = userWhite;
      playerStone.value = 0;
      presentationActive.value = true;
      presenterId.value = 999;
      originatorId.value = 999;
    });
    toPresentation("synced-viewer");
    expect(caps().canEnterAnalysis).toBe(false);
  });

  it("canExitAnalysis when in analysis", () => {
    setupPlayingGame();
    toAnalysis();
    expect(caps().canExitAnalysis).toBe(true);
  });

  it("cannot exit analysis when not in analysis", () => {
    setupPlayingGame();
    expect(caps().canExitAnalysis).toBe(false);
  });

  it("canEnterEstimate during play", () => {
    setupPlayingGame();
    expect(caps().canEnterEstimate).toBe(true);
  });

  it("canEnterEstimate on done game with settled territory", () => {
    setupPlayingGame();
    batch(() => {
      gameStage.value = GameStage.Completed;
      result.value = "B+R";
      settledTerritory.value = {
        ownership: Array(361).fill(0),
        dead_stones: [],
        score: {
          black: { territory: 50, captures: 3 },
          white: { territory: 45, captures: 2 },
        },
      };
    });
    expect(caps().canEnterEstimate).toBe(true);
  });

  it("cannot enter estimate on done game without settled territory", () => {
    setupPlayingGame();
    batch(() => {
      gameStage.value = GameStage.Completed;
      result.value = "B+R";
    });
    expect(caps().canEnterEstimate).toBe(false);
  });

  it("cannot enter estimate during territory review", () => {
    setupPlayingGame();
    gameStage.value = GameStage.TerritoryReview;
    expect(caps().canEnterEstimate).toBe(false);
  });

  it("canExitEstimate when in estimate", () => {
    setupPlayingGame();
    toEstimate();
    expect(caps().canExitEstimate).toBe(true);
  });

  it("canEnterPresentation on finished game when eligible", () => {
    setupPlayingGame();
    batch(() => {
      gameStage.value = GameStage.Completed;
      result.value = "B+R";
      canStartPresentation.value = true;
    });
    expect(caps().canEnterPresentation).toBe(true);
  });

  it("cannot enter presentation on finished game when ineligible", () => {
    setupPlayingGame();
    batch(() => {
      gameStage.value = GameStage.Completed;
      result.value = "B+R";
      canStartPresentation.value = false;
    });
    expect(caps().canEnterPresentation).toBe(false);
  });

  it("cannot enter presentation on in-progress game", () => {
    setupPlayingGame();
    expect(caps().canEnterPresentation).toBe(false);
  });

  it("canExitPresentation for presenter", () => {
    batch(() => {
      gameStage.value = GameStage.Completed;
      result.value = "B+R";
      black.value = userBlack;
      white.value = userWhite;
      playerStone.value = 1;
      currentUserId.value = 1;
      presentationActive.value = true;
      presenterId.value = 1;
      originatorId.value = 1;
    });
    toPresentation("presenter");
    expect(caps().canExitPresentation).toBe(true);
  });

  it("canExitPresentation for local-analysis viewer", () => {
    batch(() => {
      gameStage.value = GameStage.Completed;
      result.value = "B+R";
      black.value = userBlack;
      white.value = userWhite;
      playerStone.value = 0;
      currentUserId.value = 99;
      presentationActive.value = true;
      presenterId.value = 1;
      originatorId.value = 1;
    });
    toPresentation("synced-viewer");
    toPresentationLocalAnalysis();
    // Local-analysis viewers exit via canExitAnalysis, not canExitPresentation
    // (canExitPresentation is only for originator-presenters ending the session)
    expect(caps().canExitPresentation).toBe(false);
    expect(caps().canExitAnalysis).toBe(true);
  });

  it("cannot exit presentation for synced viewer", () => {
    batch(() => {
      gameStage.value = GameStage.Completed;
      result.value = "B+R";
      black.value = userBlack;
      white.value = userWhite;
      playerStone.value = 0;
      currentUserId.value = 99;
      presentationActive.value = true;
      presenterId.value = 1;
      originatorId.value = 1;
    });
    toPresentation("synced-viewer");
    expect(caps().canExitPresentation).toBe(false);
  });
});

// ===========================================================================
// 10. Board — canPlayMove
// ===========================================================================
describe("board", () => {
  it("canPlayMove on player's turn", () => {
    setupPlayingGame();
    expect(caps().canPlayMove).toBe(true);
  });

  it("false on opponent's turn", () => {
    setupPlayingGame();
    batch(() => {
      gameStage.value = GameStage.WhiteToPlay;
      currentTurn.value = -1;
    });
    expect(caps().canPlayMove).toBe(false);
  });

  it("true in analysis mode", () => {
    setupPlayingGame();
    toAnalysis();
    expect(caps().canPlayMove).toBe(true);
  });

  it("false for spectator", () => {
    setupPlayingGame();
    playerStone.value = 0;
    expect(caps().canPlayMove).toBe(false);
  });

  it("false when done", () => {
    setupPlayingGame();
    batch(() => {
      gameStage.value = GameStage.Completed;
      result.value = "B+R";
    });
    expect(caps().canPlayMove).toBe(false);
  });

  it("false during challenge", () => {
    batch(() => {
      gameStage.value = GameStage.Challenge;
      black.value = userBlack;
      white.value = userWhite;
      playerStone.value = 1;
      currentUserId.value = 1;
    });
    expect(caps().canPlayMove).toBe(false);
  });

  it("true in presentation local-analysis", () => {
    batch(() => {
      gameStage.value = GameStage.Completed;
      result.value = "B+R";
      black.value = userBlack;
      white.value = userWhite;
      playerStone.value = 0;
      currentUserId.value = 99;
      presentationActive.value = true;
      presenterId.value = 1;
      originatorId.value = 1;
    });
    toPresentation("synced-viewer");
    toPresentationLocalAnalysis();
    expect(caps().canPlayMove).toBe(true);
  });

  it("boardAspectRatio reflects game dimensions", () => {
    gameState.value = { ...defaultState, cols: 9, rows: 9 };
    expect(caps().boardAspectRatio).toBe("9/9");
  });

  it("showGhostStone when move confirm enabled and not in analysis/estimate", () => {
    setupPlayingGame();
    moveConfirmEnabled.value = true;
    expect(caps().showGhostStone).toBe(true);
  });

  it("no ghost stone in analysis mode", () => {
    setupPlayingGame();
    moveConfirmEnabled.value = true;
    toAnalysis();
    expect(caps().showGhostStone).toBe(false);
  });
});

// ===========================================================================
// 11. Claim victory (opponent gone)
// ===========================================================================
describe("claim victory", () => {
  it("not available when opponent disconnected but not gone", () => {
    setupPlayingGame();
    opponentDisconnected.value = { since: new Date(), gone: false };
    expect(caps().canClaimVictory).toBe(false);
  });

  it("available when opponent is gone", () => {
    setupPlayingGame();
    opponentDisconnected.value = { since: new Date(), gone: true };
    expect(caps().canClaimVictory).toBe(true);
  });

  it("not available when game is done", () => {
    setupPlayingGame();
    batch(() => {
      gameStage.value = GameStage.Completed;
      result.value = "B+R";
    });
    opponentDisconnected.value = { since: new Date(), gone: true };
    expect(caps().canClaimVictory).toBe(false);
  });

  it("not available for spectator", () => {
    setupPlayingGame();
    playerStone.value = 0;
    opponentDisconnected.value = { since: new Date(), gone: true };
    expect(caps().canClaimVictory).toBe(false);
  });

  it("shows countdown text during grace period", () => {
    setupPlayingGame();
    opponentDisconnected.value = {
      since: new Date(Date.now() - 5000),
      gracePeriodMs: 30000,
      gone: false,
    };
    const c = caps();
    expect(c.disconnectCountdown).toMatch(/\d+s to reconnect/);
  });

  it("shows 'left the game' when gone", () => {
    setupPlayingGame();
    opponentDisconnected.value = {
      since: new Date(),
      gracePeriodMs: 30000,
      gone: true,
    };
    expect(caps().disconnectCountdown).toBe("Opponent left the game.");
  });
});

// ===========================================================================
// 12. Move confirm toggle
// ===========================================================================
describe("move confirm toggle", () => {
  it("shown for player during play", () => {
    setupPlayingGame();
    expect(caps().showMoveConfirmToggle).toBe(true);
  });

  it("hidden for spectator", () => {
    setupPlayingGame();
    playerStone.value = 0;
    expect(caps().showMoveConfirmToggle).toBe(false);
  });

  it("hidden when done", () => {
    setupPlayingGame();
    batch(() => {
      gameStage.value = GameStage.Completed;
      result.value = "B+R";
    });
    expect(caps().showMoveConfirmToggle).toBe(false);
  });

  it("hidden during challenge", () => {
    batch(() => {
      gameStage.value = GameStage.Challenge;
      black.value = userBlack;
      white.value = userWhite;
      playerStone.value = 1;
      currentUserId.value = 1;
    });
    expect(caps().showMoveConfirmToggle).toBe(false);
  });
});

// ===========================================================================
// 13. Lobby / lifecycle
// ===========================================================================
describe("lobby / lifecycle", () => {
  it("showInviteLink when player and invite token and open slot", () => {
    batch(() => {
      gameStage.value = GameStage.Challenge;
      black.value = userBlack;
      white.value = undefined; // open slot
      playerStone.value = 1;
      currentUserId.value = 1;
      initialProps.value = {
        ...initialProps.value,
        creator_id: 1,
        invite_token: "abc123",
      };
    });
    expect(caps().showInviteLink).toBe(true);
  });

  it("no invite link without token", () => {
    batch(() => {
      gameStage.value = GameStage.Unstarted;
      black.value = userBlack;
      white.value = undefined;
      playerStone.value = 1;
      currentUserId.value = 1;
    });
    expect(caps().showInviteLink).toBe(false);
  });

  it("showChallengePopover for challengee", () => {
    batch(() => {
      gameStage.value = GameStage.Challenge;
      black.value = userBlack;
      white.value = userWhite;
      playerStone.value = -1; // we are white
      currentUserId.value = 2;
      initialProps.value = { ...initialProps.value, creator_id: 1 };
    });
    expect(caps().showChallengePopover).toBe(true);
  });

  it("no challenge popover for creator", () => {
    batch(() => {
      gameStage.value = GameStage.Challenge;
      black.value = userBlack;
      white.value = userWhite;
      playerStone.value = 1;
      currentUserId.value = 1;
      initialProps.value = { ...initialProps.value, creator_id: 1 };
    });
    expect(caps().showChallengePopover).toBe(false);
  });

  it("canRematch when game done with result and is player", () => {
    setupPlayingGame();
    batch(() => {
      gameStage.value = GameStage.Completed;
      result.value = "B+R";
    });
    expect(caps().canRematch).toBe(true);
  });

  it("cannot rematch in progress", () => {
    setupPlayingGame();
    expect(caps().canRematch).toBe(false);
  });

  it("cannot rematch as spectator", () => {
    batch(() => {
      gameStage.value = GameStage.Completed;
      result.value = "B+R";
      black.value = userBlack;
      white.value = userWhite;
      playerStone.value = 0;
    });
    expect(caps().canRematch).toBe(false);
  });
});

// ===========================================================================
// 14. Presentation-specific
// ===========================================================================
describe("presentation", () => {
  function setupPresentation(role: "presenter" | "synced-viewer") {
    batch(() => {
      gameStage.value = GameStage.Completed;
      result.value = "B+R";
      black.value = userBlack;
      white.value = userWhite;
      playerStone.value = 1;
      currentUserId.value = 1;
      presentationActive.value = true;
      presenterId.value = 1;
      originatorId.value = 1;
    });
    toPresentation(role);
  }

  it("showAnalyzeChoice for synced viewer (not presenter, not local-analysis)", () => {
    batch(() => {
      gameStage.value = GameStage.Completed;
      result.value = "B+R";
      black.value = userBlack;
      white.value = userWhite;
      playerStone.value = 0;
      currentUserId.value = 99;
      presentationActive.value = true;
      presenterId.value = 1;
      originatorId.value = 1;
    });
    toPresentation("synced-viewer");
    expect(caps().showAnalyzeChoice).toBe(true);
  });

  it("no analyzeChoice for presenter", () => {
    setupPresentation("presenter");
    expect(caps().showAnalyzeChoice).toBe(false);
  });

  it("canTakeControl for originator who is not presenter", () => {
    // Originator gave control to someone else
    batch(() => {
      gameStage.value = GameStage.Completed;
      result.value = "B+R";
      black.value = userBlack;
      white.value = userWhite;
      playerStone.value = 1;
      currentUserId.value = 1;
      presentationActive.value = true;
      presenterId.value = 2; // someone else is presenting
      originatorId.value = 1; // we are originator
    });
    toPresentation("synced-viewer");
    expect(caps().canTakeControl).toBe(true);
  });

  it("canRequestControl for non-originator non-presenter", () => {
    batch(() => {
      gameStage.value = GameStage.Completed;
      result.value = "B+R";
      black.value = userBlack;
      white.value = userWhite;
      playerStone.value = 0;
      currentUserId.value = 99;
      presentationActive.value = true;
      presenterId.value = 1;
      originatorId.value = 1;
    });
    toPresentation("synced-viewer");
    expect(caps().canRequestControl).toBe(true);
  });

  it("cannot request control when request already exists", () => {
    batch(() => {
      gameStage.value = GameStage.Completed;
      result.value = "B+R";
      black.value = userBlack;
      white.value = userWhite;
      playerStone.value = 0;
      currentUserId.value = 99;
      presentationActive.value = true;
      presenterId.value = 1;
      originatorId.value = 1;
      controlRequest.value = { userId: 50, displayName: "Other" };
    });
    toPresentation("synced-viewer");
    expect(caps().canRequestControl).toBe(false);
  });

  it("canCancelControlRequest when own request pending", () => {
    batch(() => {
      gameStage.value = GameStage.Completed;
      result.value = "B+R";
      black.value = userBlack;
      white.value = userWhite;
      playerStone.value = 0;
      currentUserId.value = 99;
      presentationActive.value = true;
      presenterId.value = 1;
      originatorId.value = 1;
      controlRequest.value = { userId: 99, displayName: "Me" };
    });
    toPresentation("synced-viewer");
    expect(caps().canCancelControlRequest).toBe(true);
  });

  it("controlRequestPending for non-originator when someone else requested", () => {
    batch(() => {
      gameStage.value = GameStage.Completed;
      result.value = "B+R";
      black.value = userBlack;
      white.value = userWhite;
      playerStone.value = 0;
      currentUserId.value = 99;
      presentationActive.value = true;
      presenterId.value = 1;
      originatorId.value = 1;
      controlRequest.value = { userId: 50, displayName: "Other" };
    });
    toPresentation("synced-viewer");
    expect(caps().controlRequestPending).toBe(true);
    expect(caps().controlRequestDisplayName).toBe("Other");
  });
});

// ===========================================================================
// 15. Chat / misc
// ===========================================================================
describe("chat and misc", () => {
  it("showChat always true", () => {
    expect(caps().showChat).toBe(true);
  });

  it("hasUnreadChat reflects signal", () => {
    hasUnreadChat.value = true;
    expect(caps().hasUnreadChat).toBe(true);
  });

  it("showMoveTree reflects signal", () => {
    showMoveTree.value = true;
    expect(caps().showMoveTree).toBe(true);
  });
});

// ===========================================================================
// 16. Estimate territory overlay on finished game
// ===========================================================================
describe("estimate territory overlay", () => {
  it("shows settled territory overlay in estimate mode on finished game", () => {
    const settled: SettledTerritoryData = {
      ownership: [1, -1, 0],
      dead_stones: [[5, 5]],
      score: {
        black: { territory: 50, captures: 3 },
        white: { territory: 45, captures: 2 },
      },
    };
    batch(() => {
      gameStage.value = GameStage.Completed;
      result.value = "B+R";
      black.value = userBlack;
      white.value = userWhite;
      playerStone.value = 1;
      currentUserId.value = 1;
      settledTerritory.value = settled;
    });
    toEstimate();
    const overlay = caps().territoryOverlay;
    expect(overlay).toBeDefined();
    expect(overlay!.paintMap).toEqual([1, -1, null]);
    expect(overlay!.dimmedVertices).toEqual([[5, 5]]);
  });

  it("no territory overlay in estimate from analysis", () => {
    const settled: SettledTerritoryData = {
      ownership: [1, -1, 0],
      dead_stones: [],
      score: {
        black: { territory: 50, captures: 3 },
        white: { territory: 45, captures: 2 },
      },
    };
    setupPlayingGame();
    settledTerritory.value = settled;
    toAnalysis();
    toEstimate();
    // phase is estimate with fromAnalysis=true => no overlay (WASM handles it)
    expect(caps().territoryOverlay).toBeUndefined();
  });
});
