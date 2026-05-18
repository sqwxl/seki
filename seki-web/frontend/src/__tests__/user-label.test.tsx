import { describe, expect, it } from "vitest";

import { UserLabel } from "../components/user-label";
import type { UserData } from "../game/types";

function user(overrides: Partial<UserData> = {}): UserData {
  return {
    id: 1,
    display_name: "alice",
    is_registered: true,
    preferences: {},
    rank: {
      qualifier: "3k",
      status: "ranked",
      rating: 1560,
      deviation: 80,
      volatility: 0.06,
      uncertain: false,
    },
    ...overrides,
  };
}

describe("UserLabel", () => {
  it("renders fallback text without fabricating user data", () => {
    const view = UserLabel({ fallback: "Unknown" }) as any;

    expect(view.type).toBe("span");
    expect(view.props.class).toBe("user-label");
    expect(view.props.children).toBe("Unknown");
  });

  it("renders a profile link from structured user data", () => {
    const view = UserLabel({
      user: user(),
      options: { link: true },
    }) as any;

    expect(view.type).toBe("a");
    expect(view.props.href).toBe("/users/alice");
  });

  it("uses explicit options for presence and emphasis", () => {
    const view = UserLabel({
      user: user(),
      options: { showPresence: true, presence: true, strong: true },
    }) as any;
    const label = view;
    const presence = label.props.children.at(-1);

    expect(label.props.class).toBe("user-label active-turn");
    expect(presence.props.class).toBe("presence-dot online");
  });

  it("can show context-specific rank values", () => {
    const view = UserLabel({
      user: user({ rank: null }),
      options: {
        rank: {
          value: {
            qualifier: "1d",
            status: "ranked",
            rating: 1820,
            deviation: 60,
            volatility: 0.06,
            uncertain: false,
          },
        },
      },
    }) as any;

    const rank = view.props.children[4];
    expect(rank.props.value.qualifier).toBe("1d");
  });
});
