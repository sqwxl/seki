import type { Board, NavAction } from "../goban/create-board";
import type { ControlsProps } from "../components/controls";
import { showCoordinates } from "../game/state";
import { toggleShowCoordinates } from "./coord-toggle";
import type { PremoveState } from "./premove";

export function buildNavProps(board: Board | undefined): ControlsProps["nav"] {
  return {
    atStart: board?.engine.is_at_start() ?? true,
    atLatest: board?.engine.is_at_latest() ?? true,
    atMainEnd: board?.engine.is_at_main_end() ?? true,
    counter: board ? `${board.engine.view_index()}` : "0",
    onNavigate: (action: NavAction) => board?.navigate(action),
  };
}

export function buildCoordsToggle(
  board: Board | undefined,
): ControlsProps["coordsToggle"] {
  return {
    enabled: showCoordinates.value,
    onClick: () => {
      showCoordinates.value = toggleShowCoordinates();
      board?.setShowCoordinates(showCoordinates.value);
    },
  };
}

export function buildMoveConfirmToggle(
  pm: PremoveState,
  board: Board | undefined,
): ControlsProps["moveConfirmToggle"] {
  return {
    enabled: pm.enabled,
    onClick: () => {
      pm.enabled = !pm.enabled;
      pm.clear();
      board?.render();
    },
  };
}
