import type { Point, Sign } from "../goban/types";
import { storage, MOVE_CONFIRMATION } from "./storage";

export function readMoveConfirmation(): boolean {
  const stored = storage.get(MOVE_CONFIRMATION);
  if (stored !== null) {
    return stored === "true";
  }
  return window.matchMedia("(max-width: 1024px)").matches;
}

export type PremoveState = {
  value: Point | undefined;
  enabled: boolean;
  getGhostStone: () => { col: number; row: number; sign: Sign } | undefined;
  clear: () => void;
};

type PremoveConfig = {
  getSign: () => Sign;
};

export function createPremove(config: PremoveConfig): PremoveState {
  let enabled = readMoveConfirmation();

  const state: PremoveState = {
    value: undefined,
    get enabled() {
      return enabled;
    },
    set enabled(v: boolean) {
      enabled = v;
      storage.set(MOVE_CONFIRMATION, String(v));
    },
    getGhostStone() {
      if (!state.value) {
        return undefined;
      }
      const [col, row] = state.value;
      return { col, row, sign: config.getSign() };
    },
    clear() {
      state.value = undefined;
    },
  };

  return state;
}
