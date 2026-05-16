import { beforeEach, describe, expect, it } from "vitest";
import { gameLabel } from "../components/notification-bell";
import { writeUserData } from "../game/util";

describe("notification bell labels", () => {
  beforeEach(() => {
    writeUserData(undefined);
  });

  it("labels challenge entries with the creator name", () => {
    writeUserData({
      id: 2,
      display_name: "bob",
      is_registered: true,
      preferences: {},
    });

    expect(
      gameLabel({
        id: 1,
        creator_id: 1,
        stage: "challenge",
        black: { id: 1, display_name: "alice" },
        white: { id: 2, display_name: "bob" },
      }),
    ).toBe("Challenge from alice");
  });

  it("falls back to the other player when creator_id is unavailable", () => {
    writeUserData({
      id: 1,
      display_name: "alice",
      is_registered: true,
      preferences: {},
    });

    expect(
      gameLabel({
        id: 1,
        stage: "challenge",
        black: { id: 1, display_name: "alice" },
        white: { id: 2, display_name: "bob" },
      }),
    ).toBe("Challenge from bob");
  });

  it("keeps turn labels unchanged for live games", () => {
    expect(
      gameLabel({
        id: 1,
        stage: "black_to_play",
        black: { id: 1, display_name: "alice" },
        white: { id: 2, display_name: "bob" },
      }),
    ).toBe("Your turn: alice vs bob");
  });
});
