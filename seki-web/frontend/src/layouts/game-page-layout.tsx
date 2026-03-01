import type { ComponentChildren, Ref } from "preact";
import { PlayerPanel } from "../components/player-panel";
import type { PlayerPanelProps } from "../components/player-panel";
import type { ControlsProps } from "../components/controls";
import { Controls } from "./controls";
import { TabBar } from "../components/tab-bar";
import { mobileTab } from "../game/state";

export type GamePageLayoutProps = {
  header?: ComponentChildren;
  gobanRef: Ref<HTMLDivElement>;
  gobanStyle?: string;
  gobanClass?: string;
  playerTop?: PlayerPanelProps;
  playerBottom?: PlayerPanelProps;
  controls?: ControlsProps;
  status?: ComponentChildren;
  chat?: ComponentChildren;
  moveTree?: ComponentChildren;
};

export function GamePageLayout(props: GamePageLayoutProps) {
  const gobanClass = ["goban-container", props.gobanClass]
    .filter(Boolean)
    .join(" ");

  const tab = mobileTab.value;
  const hasChat = !!props.chat;
  const hideTabs = hasChat ? undefined : (["chat"] as "chat"[]);

  return (
    <>
      {props.header && <div class="game-header">{props.header}</div>}
      {props.status && <div class="game-status-slot">{props.status}</div>}
      <div class={`game-board-view ${tab !== "board" ? "tab-hidden" : ""}`}>
        {props.playerTop && (
          <div class="player-label player-top">
            <PlayerPanel {...props.playerTop} />
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
          <div class="player-label player-bottom">
            <PlayerPanel {...props.playerBottom} />
          </div>
        )}
        {props.controls && (
          <div class="controls">
            <Controls {...props.controls} />
          </div>
        )}
      </div>
      <div class={`game-chat-view ${tab !== "chat" ? "tab-hidden" : ""}`}>
        {props.chat}
      </div>
      <div class={`game-tree-view ${tab !== "tree" ? "tab-hidden" : ""}`}>
        {props.moveTree}
      </div>
      <TabBar hideTabs={hideTabs} />
    </>
  );
}
