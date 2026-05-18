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
  it("renders a profile link from structured user data", () => {
    const view = UserLabel({
      user: user(),
    }) as any;

    expect(view.type).toBe("a");
    expect(view.props.href).toBe("/users/alice");
  });

  it("uses explicit options for presence and emphasis", () => {
    const view = UserLabel({
      user: user(),
      noLink: true,
      options: { showPresence: true, presence: true, strong: true },
    }) as any;
    const label = view;
    const children = Array.isArray(label.props.children)
      ? label.props.children
      : [label.props.children];
    const presence = children.at(-1);

    expect(label.props.class).toBe("user-label active-turn");
    expect(presence.props.class).toBe("presence-dot online");
  });

  it("can show context-specific rank values", () => {
    const view = UserLabel({
      user: user({ rank: null }),
      noLink: true,
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

    const children = Array.isArray(view.props.children)
      ? view.props.children
      : [view.props.children];
    const rank = children[4];
    expect(rank.props.value.qualifier).toBe("1d");
  });
});
