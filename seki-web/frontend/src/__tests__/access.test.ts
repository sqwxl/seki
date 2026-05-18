import { describe, expect, it } from "vitest";
import {
  canJoinGameFromProps,
  requiresAccessTokenToJoin,
  requiresAccessTokenToView,
  requiresInviteTokenToJoin,
  requiresInviteTokenToView,
} from "../game/access";
import { type GameSettings } from "../game/types";

const baseSettings: GameSettings = {
  cols: 19,
  rows: 19,
  handicap: 0,
  time_control: "none",
  main_time_secs: undefined,
  increment_secs: undefined,
  byoyomi_time_secs: undefined,
  byoyomi_periods: undefined,
  is_private: false,
  invite_only: false,
};

describe("game access semantics", () => {
  it("treats private as token-gated for viewing and joining", () => {
    const settings = { ...baseSettings, is_private: true };

    expect(requiresAccessTokenToView(settings)).toBe(true);
    expect(requiresAccessTokenToJoin(settings)).toBe(true);
    expect(requiresInviteTokenToJoin(settings)).toBe(false);
  });

  it("treats invite-only as token-gated for joining but not viewing", () => {
    const settings = { ...baseSettings, invite_only: true };

    expect(requiresInviteTokenToView()).toBe(false);
    expect(requiresInviteTokenToJoin(settings)).toBe(true);
    expect(requiresAccessTokenToView(settings)).toBe(false);
  });

  it("uses server-authored join capability when present", () => {
    expect(
      canJoinGameFromProps({
        isPlayer: false,
        hasOpenSlot: true,
        settings: baseSettings,
        serverCanJoinGame: false,
      }),
    ).toBe(false);
  });
});
