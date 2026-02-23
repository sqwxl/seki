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
  timeoutFlag(): void;
  territoryTimeoutFlag(): void;
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
    timeoutFlag() {
      gameSend({ action: "timeout_flag" });
    },
    territoryTimeoutFlag() {
      gameSend({ action: "territory_timeout_flag" });
    },
  };
}
