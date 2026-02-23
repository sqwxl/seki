import type { Point, Sign } from "../goban/types";

const KEY = "seki:move_confirmation";

function readMoveConfirmation(): boolean {
  const stored = localStorage.getItem(KEY);
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
      localStorage.setItem(KEY, String(v));
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
