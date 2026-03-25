import { beforeEach, describe, expect, it } from "vitest";
import {
  activeFlash,
  clearFlash,
  readFlashFromUrl,
  setFlash,
  setFlashState,
  stripFlashParams,
} from "../utils/flash";

describe("flash helpers", () => {
  beforeEach(() => {
    clearFlash();
  });

  it("stores flash severity and message", () => {
    setFlash("Saved", "success");
    expect(activeFlash.value).toEqual({
      message: "Saved",
      severity: "success",
    });
  });

  it("parses flash payload from the location query", () => {
    const flash = readFlashFromUrl(
      new URL("https://example.com/games?flash=Denied&flash_level=warning"),
    );
    expect(flash).toEqual({
      message: "Denied",
      severity: "warning",
    });
  });

  it("defaults unknown flash levels to error", () => {
    const flash = readFlashFromUrl(
      new URL("https://example.com/games?flash=Denied&flash_level=nope"),
    );
    expect(flash).toEqual({
      message: "Denied",
      severity: "error",
    });
  });

  it("strips flash params and preserves unrelated query params", () => {
    const stripped = stripFlashParams(
      new URL(
        "https://example.com/games/new?opponent=alice&flash=Denied&flash_level=error",
      ),
    );
    expect(stripped).toBe("/games/new?opponent=alice");
  });

  it("clears state when setFlashState receives undefined", () => {
    setFlash("Denied");
    setFlashState(undefined);
    expect(activeFlash.value).toBeUndefined();
  });
});
