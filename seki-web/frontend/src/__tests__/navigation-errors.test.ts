import { afterEach, describe, expect, it, vi } from "vitest";
import { buildGameNavigationRedirect } from "../utils/navigation-errors";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("game navigation redirects", () => {
  it("redirects missing games back to the games list with the spec message", () => {
    vi.stubGlobal("window", {
      location: { origin: "https://example.com" },
    });

    expect(
      buildGameNavigationRedirect(124, { status: 404, message: "Game not found" }, "/games/124"),
    ).toEqual({
      to: "/games",
      flash: "The game you were looking for (ID 124) does not exist",
    });
  });

  it("redirects protected games back to the games list with the server message", () => {
    vi.stubGlobal("window", {
      location: { origin: "https://example.com" },
    });

    expect(
      buildGameNavigationRedirect(
        8,
        { status: 403, message: "This game is private. You need a valid access token to view it." },
        "/games/8",
      ),
    ).toEqual({
      to: "/games",
      flash: "This game is private. You need a valid access token to view it.",
    });
  });
});
