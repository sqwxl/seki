import type { Signal } from "@preact/signals";
import type { ComponentChildren, Ref } from "preact";
import { GameBoardDisplay } from "../components/game-board-display";
import { undoRequest } from "../game/state";

export type GamePageLayoutProps = {
  header?: ComponentChildren;
  gobanRef: Ref<HTMLDivElement>;
  gobanClass?: string;
  cols: number;
  rows: number;
  playerTop?: ComponentChildren;
  playerBottom?: ComponentChildren;
  controls?: ComponentChildren;
  status?: ComponentChildren;
  sidebarLeft?: ComponentChildren;
  sidebarRight?: ComponentChildren;
  sidebarRightTabId?: string;
  activeTab?: Signal<string>;
  tabBar?: ComponentChildren;
};

export function GamePageLayout(props: GamePageLayoutProps) {
  const tab = props.activeTab?.value;
  const hasRight = !!props.sidebarRight;
  const rightTabActive =
    !props.sidebarRightTabId || tab === props.sidebarRightTabId;
  const showRight = hasRight && rightTabActive;
  const hideControls =
    showRight && !!props.sidebarRightTabId && undoRequest.value !== "received";

  return (
    <>
      {props.header && <div class="game-header">{props.header}</div>}
      <div class="game-board-view">
        <GameBoardDisplay
          gobanRef={props.gobanRef}
          cols={props.cols}
          rows={props.rows}
          gobanClass={props.gobanClass}
          status={props.status}
          topPanel={props.playerTop}
          bottomPanel={props.playerBottom}
          controls={props.controls}
          hideControls={hideControls}
        />
        <div class="game-sidebar-column">
          {props.sidebarLeft}
          {hasRight && (
            <div
              class={`game-sidebar-right${!showRight ? " mobile-hidden" : ""}`}
            >
              {props.sidebarRight}
            </div>
          )}
        </div>
      </div>
      {props.tabBar}
    </>
  );
}
