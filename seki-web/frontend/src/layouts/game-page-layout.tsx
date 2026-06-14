import type { ComponentChildren, Ref } from "preact";
import { GameBoardDisplay } from "../components/game-board-display";
import { mobileTab } from "../game/state";

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
  chat?: ComponentChildren;
  moveTree?: ComponentChildren;
  tabBar?: ComponentChildren;
};

export function GamePageLayout(props: GamePageLayoutProps) {
  const tab = mobileTab.value;
  const hasChat = !!props.chat;
  const showChat = hasChat && tab === "chat";

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
          hideControls={showChat}
        />
        <div class="game-sidebar-column">
          {props.moveTree}
          {hasChat && (
            <div class={`game-chat-slot${!showChat ? " mobile-hidden" : ""}`}>
              {props.chat}
            </div>
          )}
        </div>
      </div>
      {hasChat && props.tabBar}
    </>
  );
}
