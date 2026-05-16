import { beforeEach,describe,expect,it } from "vitest";

import { initialRatingParticipation } from "../components/notification-settings";
import { writeUserData } from "../game/util";
import {
initPreferences,
ratingDisplayPreference,
readRatingDisplayPreference,
savePref,
} from "../utils/preferences";
import { RATING_DISPLAY,storage } from "../utils/storage";

describe("rating display preferences", () => {
  beforeEach(() => {
    localStorage.clear();
    writeUserData(undefined);
    initPreferences();
  });

  it("defaults to kyu dan when no preference is stored", () => {
    expect(readRatingDisplayPreference()).toBe("kyu_dan");
    expect(ratingDisplayPreference.value).toBe("kyu_dan");
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
    expect(ratingDisplayPreference.value).toBe("rating");
  });

  it("falls back for invalid local values and saves valid changes", () => {
    storage.set(RATING_DISPLAY, "invalid");
    expect(readRatingDisplayPreference()).toBe("kyu_dan");

    savePref("rating_display", "rating");
    expect(storage.get(RATING_DISPLAY)).toBe("rating");
    expect(readRatingDisplayPreference()).toBe("rating");
    expect(ratingDisplayPreference.value).toBe("rating");
  });

  it("initializes the rating participation settings state", () => {
    expect(initialRatingParticipation({})).toBe(true);
    expect(initialRatingParticipation({ rating_participating: false })).toBe(
      false,
    );
    expect(initialRatingParticipation({ rating_participating: true }, false)).toBe(
      false,
    );
  });
});
