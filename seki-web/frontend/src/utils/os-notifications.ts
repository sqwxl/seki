import { signal } from "@preact/signals";
import { storage, NOTIFICATIONS } from "./storage";
import { savePref } from "./preferences";

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
  osNotificationsEnabled.value = compute();
}
