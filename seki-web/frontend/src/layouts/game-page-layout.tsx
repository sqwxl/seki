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

  return (
    <>
      {props.header && <div class="game-header">{props.header}</div>}
      {props.status && <div class="game-status-slot">{props.status}</div>}
      <div class={`game-board-view ${tab === "chat" ? "tab-hidden" : ""}`}>
        {props.playerTop && (
          <div class="player-panel player-top">
            {props.playerTop}
          </div>
        )}
        <div class="game-board-area">
          <div
            class={gobanClass}
            style={props.gobanStyle}
            ref={props.gobanRef}
          />
        </div>
        {props.playerBottom && (
          <div class="player-panel player-bottom">
            {props.playerBottom}
          </div>
        )}
        {props.controls && (
          <div class="controls">
            {props.controls}
          </div>
        )}
        {props.moveTree}
      </div>
      {hasChat && (
        <div class={`game-chat-view ${tab !== "chat" ? "tab-hidden" : ""}`}>
          {props.chat}
        </div>
      )}
      {hasChat && props.tabBar}
    </>
  );
}
