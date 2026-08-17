import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  osNotificationsEnabled,
  toggleOsNotifications,
} from "../utils/os-notifications";

type Permission = "default" | "denied" | "granted";

function setNotificationPermission(
  permission: Permission,
  requestResult: Permission = permission,
): ReturnType<typeof vi.fn> {
  const value: { permission: Permission; requestPermission?: unknown } = {
    permission,
  };
  const requestPermission = vi.fn(async () => {
    value.permission = requestResult;

    return requestResult;
  });

  value.requestPermission = requestPermission;
  vi.stubGlobal("Notification", value);
  Object.defineProperty(window, "Notification", {
    value,
    configurable: true,
  });

  return requestPermission;
}

describe("os notifications toggle", () => {
  beforeEach(() => {
    localStorage.clear();
    osNotificationsEnabled.value = false;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("follows intent while the prompt is open and reverts on denial", async () => {
    setNotificationPermission("default", "denied");

    const promise = toggleOsNotifications();

    // The checkbox already flipped on click; the signal must change so
    // consumers re-render and reconcile the DOM.
    expect(osNotificationsEnabled.value).toBe(true);

    await promise;

    expect(osNotificationsEnabled.value).toBe(false);
  });

  it("stays enabled after permission is granted", async () => {
    setNotificationPermission("default", "granted");

    await toggleOsNotifications();

    expect(osNotificationsEnabled.value).toBe(true);
  });

  it("does not prompt when the browser already denied", async () => {
    const requestPermission = setNotificationPermission("denied");

    await toggleOsNotifications();

    expect(osNotificationsEnabled.value).toBe(false);
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
