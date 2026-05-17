export type PushSubscriptionInfo = {
  id: number;
  user_agent: string;
  enabled: boolean;
};

export function isPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window;
}

export async function getVapidPublicKey(): Promise<string | undefined> {
  try {
    const response = await fetch("/api/web/vapid-public-key", {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return undefined;
    }

    const data = (await response.json()) as { public_key: string };

    return data.public_key;
  } catch {
    return undefined;
  }
}

export async function subscribeToPush(): Promise<
  PushSubscriptionJSON | undefined
> {
  if (!isPushSupported()) {
    return undefined;
  }

  const vapidKey = await getVapidPublicKey();

  if (!vapidKey) {
    return undefined;
  }

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  });

  return subscription.toJSON();
}

export async function registerSubscription(
  subscription: PushSubscriptionJSON,
  userAgent?: string,
): Promise<{ id: number } | undefined> {
  try {
    const response = await fetch("/api/push-subscription", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        user_agent: userAgent ?? navigator.userAgent,
        keys: subscription.keys,
      }),
    });

    if (!response.ok) {
      return undefined;
    }

    return (await response.json()) as { id: number };
  } catch {
    return undefined;
  }
}

export async function unsubscribePush(
  subscriptionId?: number,
): Promise<boolean> {
  if (isPushSupported()) {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    await subscription?.unsubscribe();
  }

  if (!subscriptionId) {
    return true;
  }

  try {
    const response = await fetch(`/api/push-subscription/${subscriptionId}`, {
      method: "DELETE",
      headers: { Accept: "application/json" },
    });

    return response.ok;
  } catch {
    return false;
  }
}

function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}
