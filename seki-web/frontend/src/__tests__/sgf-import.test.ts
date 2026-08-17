import { describe, expect, it } from "vitest";
import { validateSgfMeta } from "../utils/sgf-import";

describe("validateSgfMeta", () => {
  it("rejects SGF parse errors", () => {
    expect(
      validateSgfMeta({ cols: 19, rows: 19, error: "unbalanced" }),
    ).toEqual({ ok: false, error: "SGF error: unbalanced" });
  });

  it("rejects non-square boards", () => {
    expect(validateSgfMeta({ cols: 19, rows: 13 })).toEqual({
      ok: false,
      error: "Non-square boards are not supported.",
    });
  });

  it("rejects unsupported board sizes", () => {
    expect(validateSgfMeta({ cols: 11, rows: 11 })).toEqual({
      ok: false,
      error: "Unsupported board size: 11×11",
    });
  });

  it("accepts supported square sizes", () => {
    for (const size of [9, 13, 19]) {
      expect(validateSgfMeta({ cols: size, rows: size })).toEqual({
        ok: true,
        size,
      });
    }
  });
});
