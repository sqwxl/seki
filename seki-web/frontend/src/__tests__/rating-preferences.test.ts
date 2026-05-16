import { beforeEach, describe, expect, it } from "vitest";

import { writeUserData } from "../game/util";
import {
  initPreferences,
  readRatingDisplayPreference,
  savePref,
} from "../utils/preferences";
import { storage, RATING_DISPLAY } from "../utils/storage";

describe("rating display preferences", () => {
  beforeEach(() => {
    localStorage.clear();
    writeUserData(undefined);
    initPreferences();
  });

  it("defaults to kyu dan when no preference is stored", () => {
    expect(readRatingDisplayPreference()).toBe("kyu_dan");
  });

  it("persists the server rating display preference locally", () => {
    writeUserData({
      id: 1,
      display_name: "honinbo",
      is_registered: true,
      preferences: { rating_display: "rating" },
    });

    initPreferences();

    expect(storage.get(RATING_DISPLAY)).toBe("rating");
    expect(readRatingDisplayPreference()).toBe("rating");
  });

  it("falls back for invalid local values and saves valid changes", () => {
    storage.set(RATING_DISPLAY, "invalid");
    expect(readRatingDisplayPreference()).toBe("kyu_dan");

    savePref("rating_display", "rating");
    expect(storage.get(RATING_DISPLAY)).toBe("rating");
    expect(readRatingDisplayPreference()).toBe("rating");
  });
});
