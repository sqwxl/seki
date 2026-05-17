import { signal } from "@preact/signals";
import {
  registerSubscription,
  subscribeToPush,
  unsubscribePush,
} from "../push";
import { savePref } from "./preferences";
import { NOTIFICATIONS, PUSH_SUBSCRIPTION_ID, storage } from "./storage";

function readPushSubscriptionId(): number | undefined {
  const value = storage.get(PUSH_SUBSCRIPTION_ID);

  if (!value) {
    return undefined;
  }

  const id = Number(value);

  return Number.isInteger(id) ? id : undefined;
}

function compute(): boolean {
  return (
    "Notification" in window &&
    storage.get(NOTIFICATIONS) === "on" &&
    Notification.permission === "granted"
  );
}

export const osNotificationsEnabled = signal(compute());

export async function toggleOsNotifications(): Promise<void> {
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
