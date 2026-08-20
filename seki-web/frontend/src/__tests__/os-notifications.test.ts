import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  osNotificationsEnabled,
  repairPushSubscriptionIfNeeded,
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

describe("push subscription repair", () => {
  beforeEach(() => {
    localStorage.clear();
    osNotificationsEnabled.value = false;
  });

  it("re-subscribes when the browser subscription died but a server id is stored", async () => {
    setNotificationPermission("granted");
    localStorage.setItem("seki:notifications", "on");
    localStorage.setItem("seki:push_subscription_id", "7");

    const subscribe = vi.fn(async () => ({
      endpoint: "https://push.example/endpoint",
      toJSON: () => ({
        endpoint: "https://push.example/endpoint",
        keys: { p256dh: "x", auth: "y" },
      }),
    }));
    const registration = {
      pushManager: {
        getSubscription: vi.fn(async () => undefined),
        subscribe,
      },
    };
    Object.defineProperty(window, "PushManager", {
      value: {},
      configurable: true,
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        addEventListener: vi.fn(),
        register: vi.fn(async () => registration),
        ready: Promise.resolve(registration),
      },
    });

    const calls: Array<[string, string]> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push([String(url), init?.method ?? "GET"]);

        if (String(url).includes("vapid-public-key")) {
          return new Response(JSON.stringify({ public_key: "abc" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (init?.method === "DELETE") {
          return new Response(null, { status: 200 });
        }

        return new Response(JSON.stringify({ id: 8 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    await repairPushSubscriptionIfNeeded();

    expect(registration.pushManager.getSubscription).toHaveBeenCalled();
    expect(subscribe).toHaveBeenCalled();
    expect(localStorage.getItem("seki:push_subscription_id")).toBe("8");
    expect(
      calls.some(([url, method]) => url.endsWith("/7") && method === "DELETE"),
    ).toBe(true);
  });

  it("no-ops when the subscription is healthy", async () => {
    setNotificationPermission("granted");
    localStorage.setItem("seki:notifications", "on");
    localStorage.setItem("seki:push_subscription_id", "7");

    const registration = {
      pushManager: {
        getSubscription: vi.fn(async () => ({
          endpoint: "https://push.example/e",
        })),
        subscribe: vi.fn(),
      },
    };
    Object.defineProperty(window, "PushManager", {
      value: {},
      configurable: true,
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        addEventListener: vi.fn(),
        register: vi.fn(async () => registration),
        ready: Promise.resolve(registration),
      },
    });

    const calls: Array<[string, string]> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push([String(url), init?.method ?? "GET"]);

        return new Response(
          JSON.stringify({
            subscriptions: [
              { id: 7, endpoint: "https://push.example/e", enabled: true },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    await repairPushSubscriptionIfNeeded();

    expect(registration.pushManager.subscribe).not.toHaveBeenCalled();
    expect(localStorage.getItem("seki:push_subscription_id")).toBe("7");
  });

  it("re-registers when the browser subscription is dead server-side", async () => {
    setNotificationPermission("granted");
    localStorage.setItem("seki:notifications", "on");
    localStorage.setItem("seki:push_subscription_id", "7");

    const subscribe = vi.fn();
    const registration = {
      pushManager: {
        getSubscription: vi.fn(async () => ({
          endpoint: "https://push.example/dead",
          toJSON: () => ({
            endpoint: "https://push.example/dead",
            keys: { p256dh: "x", auth: "y" },
          }),
        })),
        subscribe,
      },
    };
    Object.defineProperty(window, "PushManager", {
      value: {},
      configurable: true,
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        addEventListener: vi.fn(),
        register: vi.fn(async () => registration),
        ready: Promise.resolve(registration),
      },
    });

    const calls: Array<[string, string]> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push([String(url), init?.method ?? "GET"]);

        if (init?.method === "POST") {
          return new Response(JSON.stringify({ id: 9 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        // The browser endpoint has no enabled server entry (410'd).
        return new Response(
          JSON.stringify({
            subscriptions: [
              { id: 7, endpoint: "https://push.example/other", enabled: false },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    await repairPushSubscriptionIfNeeded();

    expect(
      calls.some(
        ([url, method]) =>
          url.endsWith("/api/push-subscription") && method === "POST",
      ),
    ).toBe(true);
    expect(localStorage.getItem("seki:push_subscription_id")).toBe("9");
  });
});
