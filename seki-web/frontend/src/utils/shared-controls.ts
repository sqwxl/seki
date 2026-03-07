import type { Board, NavAction } from "../goban/create-board";
import type { ControlsProps } from "../components/controls";

export function buildNavProps(board: Board | undefined): ControlsProps["nav"] {
  return {
    atStart: board?.engine.is_at_start() ?? true,
    atLatest: board?.engine.is_at_latest() ?? true,
    atMainEnd: board?.engine.is_at_main_end() ?? true,
    counter: board ? `${board.engine.view_index()}` : "0",
    onNavigate: (action: NavAction) => board?.navigate(action),
  };
}
