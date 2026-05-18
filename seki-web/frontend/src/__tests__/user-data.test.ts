import { beforeEach, describe, expect, it } from "vitest";

import { readUserData, writeUserData } from "../game/util";
import { USER_DATA, storage } from "../utils/storage";

describe("user data cache", () => {
  beforeEach(() => {
    localStorage.clear();
    writeUserData(undefined);
  });

  it("stores user data in localStorage", () => {
    writeUserData({
      id: 12,
      display_name: "cached-user",
      is_registered: false,
      preferences: {},
    });

    expect(storage.getJson(USER_DATA)).toEqual({
      id: 12,
      display_name: "cached-user",
      is_registered: false,
      preferences: {},
    });
  });

  it("reads user data from localStorage", () => {
    storage.setJson(USER_DATA, {
      id: 34,
      display_name: "restored-user",
      is_registered: true,
      preferences: {},
    });

    expect(readUserData()?.display_name).toBe("restored-user");
  });
});
