import { GameStage, type GameSettings } from "./types";

export type AccessBadge = {
  label: string;
  title: string;
};

export function isChallengeStage(stage: GameStage): boolean {
  return stage === GameStage.Challenge;
}

export function requiresInviteTokenToView(): boolean {
  return false;
}

export function requiresAccessTokenToView(
  settings: Pick<GameSettings, "is_private">,
): boolean {
  return settings.is_private;
}

export function requiresAccessTokenToJoin(
  settings: Pick<GameSettings, "is_private">,
): boolean {
  return settings.is_private;
}

export function requiresInviteTokenToJoin(
  settings: Pick<GameSettings, "is_private" | "invite_only">,
): boolean {
  return settings.invite_only;
}

export function canJoinGameFromProps(input: {
  isPlayer: boolean;
  hasOpenSlot: boolean;
  settings: Pick<GameSettings, "is_private" | "invite_only">;
  hasValidAccessToken?: boolean;
  serverCanJoinGame?: boolean;
}): boolean {
  return (
    input.serverCanJoinGame ??
    (!input.isPlayer &&
      input.hasOpenSlot &&
      (!requiresAccessTokenToJoin(input.settings) ||
        !!input.hasValidAccessToken) &&
      !requiresInviteTokenToJoin(input.settings))
  );
}
