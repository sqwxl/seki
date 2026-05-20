import { signal } from "@preact/signals";
import { getFcmToken, isNativeApp, onBridgeReady } from "../native/bridge";
import {
  registerSubscription,
  subscribeToPush,
  unsubscribePush,
} from "../push";
import { savePref } from "./preferences";
import { NOTIFICATIONS, PUSH_SUBSCRIPTION_ID, storage } from "./storage";

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

  const next = storage.get(NOTIFICATIONS) === "on" ? "off" : "on";
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
