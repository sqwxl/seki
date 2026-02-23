import type { Board, NavAction } from "./board";
import type { ControlsProps } from "./controls";
import { toggleShowCoordinates } from "./coord-toggle";
import type { PremoveState } from "./premove";

export type CoordsToggleState = {
  showCoordinates: boolean;
};

export function buildNavProps(board: Board | undefined): ControlsProps["nav"] {
  return {
    atStart: board?.engine.is_at_start() ?? true,
    atLatest: board?.engine.is_at_latest() ?? true,
    counter: board ? `${board.engine.view_index()}` : "0",
    onNavigate: (action: NavAction) => board?.navigate(action),
  };
}

export function buildCoordsToggle(
  board: Board | undefined,
  state: CoordsToggleState,
): ControlsProps["coordsToggle"] {
  return {
    enabled: state.showCoordinates,
    onClick: () => {
      state.showCoordinates = toggleShowCoordinates();
      board?.setShowCoordinates(state.showCoordinates);
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
