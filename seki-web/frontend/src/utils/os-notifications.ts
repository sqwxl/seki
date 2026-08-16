import { signal } from "@preact/signals";
import { getFcmToken, isNativeApp, onBridgeReady } from "../native/bridge";
import {
  isPushSupported,
  registerSubscription,
  subscribeToPush,
  unsubscribePush,
} from "../push";
import { setFlash } from "./flash";
import { savePref } from "./preferences";
import {
  NOTIFICATIONS,
  NOTIF_PROMPTED,
  PUSH_SUBSCRIPTION_ID,
  storage,
} from "./storage";

const FCM_TOKEN_ID = "seki:fcm_token_id";

function readPushSubscriptionId(): number | undefined {
  const value = storage.get(PUSH_SUBSCRIPTION_ID);

  if (!value) {
    return undefined;
  }

  const id = Number(value);

  return Number.isInteger(id) ? id : undefined;
}

function readFcmTokenId(): number | undefined {
  const value = storage.get(FCM_TOKEN_ID);

  if (!value) {
    return undefined;
  }

  const id = Number(value);

  return Number.isInteger(id) ? id : undefined;
}

function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

function isStandalonePwa(): boolean {
  return (
    navigator.standalone === true ||
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches)
  );
}

function iosNeedsInstall(): boolean {
  return isIos() && !isStandalonePwa();
}

function compute(): boolean {
  if (isNativeApp()) {
    return storage.get(NOTIFICATIONS) === "on";
  }

  return (
    "Notification" in window &&
    storage.get(NOTIFICATIONS) === "on" &&
    Notification.permission === "granted"
  );
}

export const osNotificationsEnabled = signal(compute());

// Ask once per device, at value moments (creating or joining a game). The
// localStorage marker is set the moment we prompt, so granting, denying, or
// dismissing all count as "asked". Never toggles notifications off — only
// prompts when they are currently off and the permission is still askable.
export function promptForOsNotificationsIfDisabled(): void {
  if (osNotificationsEnabled.value || storage.get(NOTIF_PROMPTED) != null) {
    return;
  }

  if (
    !("Notification" in window) ||
    Notification.permission !== "default" ||
    !isPushSupported()
  ) {
    return;
  }

  storage.set(NOTIF_PROMPTED, "1");
  void toggleOsNotifications();
}

async function registerFcmToken(): Promise<void> {
  const token = getFcmToken();

  if (!token) {
    return;
  }

  try {
    const response = await fetch("/api/fcm-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        device_type: "android",
        user_agent: navigator.userAgent,
      }),
    });

    if (response.ok) {
      const data = (await response.json()) as { id: number };
      storage.set(FCM_TOKEN_ID, String(data.id));
    }
  } catch {
    // Token registration failed in background
  }
}

async function unregisterFcmToken(): Promise<void> {
  const id = readFcmTokenId();

  if (!id) {
    return;
  }

  try {
    await fetch(`/api/fcm-token/${id}`, { method: "DELETE" });
  } catch {
    // Token unregistration failed in background
  }

  storage.remove(FCM_TOKEN_ID);
}

export async function toggleOsNotifications(): Promise<void> {
  if (isNativeApp()) {
    const next = storage.get(NOTIFICATIONS) === "on" ? "off" : "on";
    storage.set(NOTIFICATIONS, next);
    savePref("notifications", next);

    if (next === "on") {
      onBridgeReady(() => {
        registerFcmToken();
      });
    } else {
      await unregisterFcmToken();
    }

    osNotificationsEnabled.value = compute();
    return;
  }

  if (!("Notification" in window)) {
    return;
  }

  const next = storage.get(NOTIFICATIONS) === "on" ? "off" : "on";

  if (next === "on" && iosNeedsInstall()) {
    setFlash(
      "On iPhone or iPad, install Seki to your Home Screen to enable push notifications. In Safari, tap Share, then Add to Home Screen (under View More if hidden).",
      "info",
    );

    return;
  }

  if (Notification.permission === "denied") {
    return;
  }

  if (Notification.permission === "default") {
    const result = await Notification.requestPermission();

    if (result !== "granted") {
      osNotificationsEnabled.value = false;

      return;
    }
  }

  storage.set(NOTIFICATIONS, next);
  savePref("notifications", next);

  if (next === "on") {
    const subscription = await subscribeToPush();

    if (subscription) {
      const result = await registerSubscription(subscription);

      if (result) {
        storage.set(PUSH_SUBSCRIPTION_ID, String(result.id));
      }
    }
  } else {
    const subscriptionId = readPushSubscriptionId();

    if (subscriptionId) {
      await unsubscribePush(subscriptionId);
      storage.remove(PUSH_SUBSCRIPTION_ID);
    } else {
      await unsubscribePush();
    }
  }

  osNotificationsEnabled.value = compute();
}

// On native, auto-register FCM token when bridge becomes ready AND notifications are enabled
if (isNativeApp() && compute()) {
  onBridgeReady(() => {
    registerFcmToken();
  });
}
