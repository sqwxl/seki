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
  disconnectAbort(): void;
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

export function createGameChannel(gameId: number): GameChannel {
  function gameSend(data: Record<string, unknown>): void {
    send({ game_id: gameId, ...data });
  }

  return {
    play(col, row) {
      gameSend({ action: "play", col, row });
    },
    pass() {
      gameSend({ action: "pass" });
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
    disconnectAbort() {
      gameSend({ action: "disconnect_abort" });
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
