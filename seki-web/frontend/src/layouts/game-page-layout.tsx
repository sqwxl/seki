import type { ComponentChildren, Ref } from "preact";
import { mobileTab } from "../game/state";

export type GamePageLayoutProps = {
  header?: ComponentChildren;
  gobanRef: Ref<HTMLDivElement>;
  gobanStyle?: string;
  gobanClass?: string;
  playerTop?: ComponentChildren;
  playerBottom?: ComponentChildren;
  controls?: ComponentChildren;
  status?: ComponentChildren;
  chat?: ComponentChildren;
  moveTree?: ComponentChildren;
  tabBar?: ComponentChildren;
};

export function GamePageLayout(props: GamePageLayoutProps) {
  const gobanClass = ["goban-container", props.gobanClass]
    .filter(Boolean)
    .join(" ");

  const tab = mobileTab.value;
  const hasChat = !!props.chat;
  const showChat = hasChat && tab === "chat";

  return (
    <>
      {props.header && <div class="game-header">{props.header}</div>}
      <div class="game-board-view">
        <div class="game-board-column">
          {props.status && <div class="game-status-slot">{props.status}</div>}
          <div class="board-main">
            {props.playerTop && (
              <div class="player-panel player-top">{props.playerTop}</div>
            )}
            <div class="game-board-area">
              <div
                class={gobanClass}
                style={props.gobanStyle}
                ref={props.gobanRef}
              />
            </div>
            {props.playerBottom && (
              <div class="player-panel player-bottom">{props.playerBottom}</div>
            )}
          </div>
          {!showChat && props.controls && (
            <div class="controls">{props.controls}</div>
          )}
        </div>
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
