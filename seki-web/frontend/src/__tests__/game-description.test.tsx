import { describe, expect, it } from "vitest";

import {
  GameDescription,
  type LiveGameItem,
} from "../components/game-description";
import { GameStage, type UserData } from "../game/types";
import { formatGameDescription } from "../utils/format";

const user: UserData = {
  id: 1,
  display_name: "Alice",
  is_registered: true,
  preferences: {},
};

function game(overrides: Partial<LiveGameItem> = {}): LiveGameItem {
  return {
    id: 1,
    creator_id: 1,
    creator: user,
    opponent: undefined,
    stage: GameStage.Unstarted,
    result: undefined,
    black: undefined,
    white: undefined,
    settings: {
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
    },
    move_count: undefined,
    ...overrides,
  };
}

function textOf(node: any): string {
  if (node == null || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  const children = node.props?.children;
  if (Array.isArray(children)) {
    return children.map(textOf).join("");
  }
  return textOf(children);
}

describe("GameDescription", () => {
  it("uses ??? for unresolved open-game slots", () => {
    const view = GameDescription({ ...game() }) as any;

    expect(textOf(view)).toContain("???");
    expect(textOf(view)).not.toContain("White");
    expect(textOf(view)).not.toContain("Black");
  });

  it("shows creator and opponent names before colors are assigned", () => {
    expect(
      formatGameDescription({
        creator_id: 1,
        creator: user,
        opponent: {
          id: 2,
          display_name: "Bob",
          is_registered: true,
          preferences: {},
        },
        black: undefined,
        white: undefined,
        settings: game().settings,
        stage: GameStage.Unstarted,
        result: undefined,
        move_count: undefined,
      }),
    ).toContain("Alice vs Bob");
  });
});
