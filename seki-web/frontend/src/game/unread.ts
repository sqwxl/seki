/**
 * Global unread-game tracking with cross-tab sync.
 *
 * Subscribes to WS lobby messages (init, game_updated, game_created, game_removed)
 * and maintains a signal-based Map of unread games. Cross-tab sync via BroadcastChannel.
 */

import { signal, computed } from "@preact/signals";
import { subscribe } from "../ws";
import { GameStage } from "./types";
import type { UserData } from "./types";
import type {
  InitMessage,
  GameUpdatedMessage,
  GameCreatedMessage,
  GameRemovedMessage,
} from "../layouts/games-list";
import type { LiveGameItem } from "../components/game-description";

export type UnreadGame = {
  id: number;
  stage: string;
  black: UserData | undefined;
  white: UserData | undefined;
};

// --- Signals ---

export const unreadGames = signal<Map<number, UnreadGame>>(new Map());
export const hasUnread = computed(() => unreadGames.value.size > 0);

// --- Cross-tab sync ---

let bc: BroadcastChannel | undefined;

function broadcastMarkRead(gameId: number): void {
  bc?.postMessage({ type: "mark_read", gameId });
}

// --- Helpers ---

let currentPlayerId: number | undefined;

function isMyTurn(
  stage: string,
  blackId: number | undefined,
  whiteId: number | undefined,
  creatorId: number | undefined,
): boolean {
  if (!currentPlayerId) {
    return false;
  }
  switch (stage) {
    case GameStage.BlackToPlay:
      return blackId === currentPlayerId;
    case GameStage.WhiteToPlay:
      return whiteId === currentPlayerId;
    case GameStage.Challenge:
      return (
        creatorId !== currentPlayerId &&
        (blackId === currentPlayerId || whiteId === currentPlayerId)
      );
    default:
      return false;
  }
}

function addUnread(game: LiveGameItem): void {
  const next = new Map(unreadGames.value);
  next.set(game.id, {
    id: game.id,
    stage: game.stage,
    black: game.black,
    white: game.white,
  });
  unreadGames.value = next;
}

function removeUnread(gameId: number): void {
  if (!unreadGames.value.has(gameId)) {
    return;
  }
  const next = new Map(unreadGames.value);
  next.delete(gameId);
  unreadGames.value = next;
}

// --- Public API ---

export function markRead(gameId: number): void {
  removeUnread(gameId);
  broadcastMarkRead(gameId);
}

export function initUnreadTracking(): void {
  // Cross-tab sync
  if ("BroadcastChannel" in window) {
    bc = new BroadcastChannel("seki-notifications");
    bc.onmessage = (e) => {
      if (e.data?.type === "mark_read") {
        removeUnread(e.data.gameId);
      }
    };
  }

  // Init message — populate from player_games where unread === true
  subscribe<InitMessage>("init", (msg) => {
    currentPlayerId = msg.player_id;
    const next = new Map<number, UnreadGame>();
    for (const g of msg.player_games) {
      if ((g as LiveGameItem & { unread?: boolean }).unread) {
        next.set(g.id, {
          id: g.id,
          stage: g.stage,
          black: g.black,
          white: g.white,
        });
      }
    }
    unreadGames.value = next;
  });

  // Game updated — check if it became my turn
  subscribe<GameUpdatedMessage>("game_updated", (msg) => {
    const g = msg.game;
    const myTurn = isMyTurn(g.stage, g.black?.id, g.white?.id, undefined);
    if (myTurn) {
      // Only add if we don't already have it (server-side read state is authoritative on init)
      if (!unreadGames.value.has(g.id)) {
        const next = new Map(unreadGames.value);
        next.set(g.id, {
          id: g.id,
          stage: g.stage,
          black: g.black,
          white: g.white,
        });
        unreadGames.value = next;
      }
    } else {
      removeUnread(g.id);
    }
  });

  // Game created — check if it's a challenge for me
  subscribe<GameCreatedMessage>("game_created", (msg) => {
    const g = msg.game;
    if (isMyTurn(g.stage, g.black?.id, g.white?.id, g.creator_id)) {
      addUnread(g);
    }
  });

  // Game removed
  subscribe<GameRemovedMessage>("game_removed", (msg) => {
    removeUnread(msg.game_id);
  });
}
