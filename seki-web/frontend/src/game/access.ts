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

export function gameAccessBadges(
  settings: Pick<GameSettings, "is_private" | "invite_only">,
  stage: GameStage,
): AccessBadge[] {
  const badges: AccessBadge[] = [];

  if (settings.is_private) {
    badges.push({
      label: "Private",
      title: "Hidden from non-participants unless they have the access link.",
    });
  }

  if (settings.invite_only) {
    badges.push({
      label: "Invite-only",
      title: "An empty seat can only be filled with the invite link.",
    });
  }

  if (isChallengeStage(stage)) {
    badges.push({
      label: "Challenge",
      title: "Both seats are assigned. The invited player must accept or decline.",
    });
  }

  return badges;
}
