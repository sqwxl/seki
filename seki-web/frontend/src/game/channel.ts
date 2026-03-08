import { send } from "../ws";

export type GameChannel = {
  play(col: number, row: number): void;
  pass(): void;
  resign(): void;
  toggleChain(col: number, row: number): void;
  say(message: string): void;
  requestUndo(): void;
  acceptUndo(): void;
  rejectUndo(): void;
  approveTerritory(): void;
  abort(): void;
  claimVictory(): void;
  acceptChallenge(): void;
  declineChallenge(): void;
  timeoutFlag(): void;
  territoryTimeoutFlag(): void;
  startPresentation(): void;
  endPresentation(): void;
  sendPresentationState(snapshot: string): void;
  giveControl(targetUserId: number): void;
  takeControl(): void;
  requestControl(): void;
  cancelControlRequest(): void;
  rejectControlRequest(): void;
};

export type MoveTimeFn = () => number | undefined;

export function createGameChannel(
  gameId: number,
  getMoveTimeMs?: MoveTimeFn,
): GameChannel {
  function gameSend(data: Record<string, unknown>): void {
    send({ game_id: gameId, ...data });
  }

  function gameSendWithTiming(data: Record<string, unknown>): void {
    const moveTime = getMoveTimeMs?.();
    if (moveTime != null) {
      data.client_move_time_ms = Math.round(moveTime);
    }
    gameSend(data);
  }

  return {
    play(col, row) {
      gameSendWithTiming({ action: "play", col, row });
    },
    pass() {
      gameSendWithTiming({ action: "pass" });
    },
    resign() {
      gameSend({ action: "resign" });
    },
    toggleChain(col, row) {
      gameSend({ action: "toggle_chain", col, row });
    },
    say(message) {
      gameSend({ action: "chat", message });
    },
    requestUndo() {
      gameSend({ action: "request_undo" });
    },
    acceptUndo() {
      gameSend({ action: "respond_to_undo", response: "accept" });
    },
    rejectUndo() {
      gameSend({ action: "respond_to_undo", response: "reject" });
    },
    approveTerritory() {
      gameSend({ action: "approve_territory" });
    },
    abort() {
      gameSend({ action: "abort" });
    },
    claimVictory() {
      gameSend({ action: "claim_victory" });
    },
    acceptChallenge() {
      gameSend({ action: "accept_challenge" });
    },
    declineChallenge() {
      gameSend({ action: "decline_challenge" });
    },
    timeoutFlag() {
      gameSend({ action: "timeout_flag" });
    },
    territoryTimeoutFlag() {
      gameSend({ action: "territory_timeout_flag" });
    },
    startPresentation() {
      gameSend({ action: "start_presentation" });
    },
    endPresentation() {
      gameSend({ action: "end_presentation" });
    },
    sendPresentationState(snapshot) {
      gameSend({ action: "presentation_state", snapshot });
    },
    giveControl(targetUserId) {
      gameSend({ action: "give_control", target_user_id: targetUserId });
    },
    takeControl() {
      gameSend({ action: "take_control" });
    },
    requestControl() {
      gameSend({ action: "request_control" });
    },
    cancelControlRequest() {
      gameSend({ action: "cancel_control_request" });
    },
    rejectControlRequest() {
      gameSend({ action: "reject_control_request" });
    },
  };
}
