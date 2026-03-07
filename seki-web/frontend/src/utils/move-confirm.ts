import type { Point, Sign } from "../goban/types";
import { storage, MOVE_CONFIRMATION } from "./storage";

export function readMoveConfirmation(): boolean {
  const stored = storage.get(MOVE_CONFIRMATION);
  if (stored !== null) {
    return stored === "true";
  }
  return window.matchMedia("(max-width: 1199px)").matches;
}

export type MoveConfirmState = {
  value: Point | undefined;
  enabled: boolean;
  getGhostStone: () => { col: number; row: number; sign: Sign } | undefined;
  clear: () => void;
};

type MoveConfirmConfig = {
  getSign: () => Sign;
};

export function createMoveConfirm(config: MoveConfirmConfig): MoveConfirmState {
  let enabled = readMoveConfirmation();

  const state: MoveConfirmState = {
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

/**
 * Handle a vertex click with move confirmation logic.
 * Returns whether the move was "set as pending" (true) or "confirmed/rejected" (false).
 * The caller decides what to do with the return value (e.g. play the stone).
 */
export function handleMoveConfirmClick(
  mc: MoveConfirmState,
  col: number,
  row: number,
  isLegal: boolean,
): "confirm" | "set" | "clear" {
  if (mc.value && mc.value[0] === col && mc.value[1] === row) {
    mc.clear();
    return "confirm";
  }
  if (isLegal) {
    mc.value = [col, row];
    return "set";
  }
  mc.clear();
  return "clear";
}

/**
 * Register a pointerdown listener that clears the pending move confirmation
 * when clicking outside the goban element.
 */
export function dismissMoveConfirmOnClickOutside(
  mc: MoveConfirmState,
  gobanEl: () => HTMLElement | null | undefined,
  onDismiss: () => void,
): void {
  document.addEventListener("pointerdown", (e) => {
    if (!mc.value) {
      return;
    }
    if (gobanEl()?.contains(e.target as Node)) {
      return;
    }
    mc.clear();
    onDismiss();
  });
}
