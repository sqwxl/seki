// @ts-nocheck -- ServiceWorkerGlobalScope types
const CACHE_NAME = "seki-v4";
const MODEL_CACHE_NAME = "seki-ai-models-v1";
const NETWORK_ONLY_PATHS = ["/static/css/", "/static/dist/", "/static/wasm/"];
const CACHE_FIRST_PATHS = ["/static/images/", "/static/sounds/"];
const MODEL_PATHS = ["/static/models/"];

self.addEventListener("install", () => {
  // The SPA shell embeds user-specific bootstrap data, so do not precache it.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  if (__DEV__) {
    event.waitUntil(self.registration.unregister());
    return;
  }

  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
    }),
  );

  self.clients.claim();
});

function isStaticAsset(url: URL): boolean {
  return [...NETWORK_ONLY_PATHS, ...CACHE_FIRST_PATHS, ...MODEL_PATHS].some(
    (p) => url.pathname.startsWith(p),
  );
}

function isModelAsset(url: URL): boolean {
  return MODEL_PATHS.some((p) => url.pathname.startsWith(p));
}

function isNetworkOnlyAsset(url: URL): boolean {
  return NETWORK_ONLY_PATHS.some((p) => url.pathname.startsWith(p));
}

function isApiRequest(url: URL): boolean {
  return url.pathname.startsWith("/api/");
}

function isGameDataRequest(url: URL): boolean {
  return /^\/api\/web\/games\/\d+$/.test(url.pathname);
}

function offlineJson(): Response {
  return new Response(JSON.stringify({ error: "offline" }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });
}

async function hasActiveClient(): Promise<boolean> {
  const clients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  return clients.some(
    (client) => client.focused || client.visibilityState === "visible",
  );
}

async function preloadGameState(gameId: number): Promise<void> {
  const url = `/api/web/games/${gameId}`;

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(url, response);
    }
  } catch {
    // Preload failure is non-fatal; the page fetches normally.
  }
}

async function fetchAndCache(request: Request): Promise<Response> {
  const response = await fetch(request);

  if (response.ok) {
    const clone = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
  }

  return response;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== "GET") {
    return;
  }

  if (isGameDataRequest(url)) {
    const network = fetch(event.request).then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, response.clone());
      }

      return response;
    });

    event.waitUntil(network.catch(() => undefined));

    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);

        return cached ?? (await network.catch(() => offlineJson()));
      }),
    );

    return;
  }

  if (isApiRequest(url)) {
    event.respondWith(fetch(event.request).catch(() => offlineJson()));

    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request));
    return;
  }

  if (isStaticAsset(url)) {
    if (isModelAsset(url)) {
      event.respondWith(
        caches.open(MODEL_CACHE_NAME).then((cache) =>
          cache.match(event.request).then((cached) => {
            if (cached) {
              return cached;
            }

            return fetch(event.request).then((response) => {
              if (response.ok) {
                cache.put(event.request, response.clone());
              }

              return response;
            });
          }),
        ),
      );

      return;
    }

    if (isNetworkOnlyAsset(url)) {
      event.respondWith(fetch(event.request));

      return;
    }

    event.respondWith(
      caches
        .match(event.request)
        .then((cached) => {
          if (cached) {
            return cached;
          }

          return fetchAndCache(event.request);
        })
        .then((response) => {
          if (response) {
            return response;
          }

          return fetchAndCache(event.request);
        }),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached ?? fetch(event.request);
    }),
  );
});

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

async function fetchVapidPublicKey(): Promise<string | undefined> {
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

// Re-register a (re)created subscription under the current session and tell
// open clients the new server-side id so their toggle can still revoke it.
async function registerPushSubscription(
  subscription: PushSubscription,
): Promise<void> {
  const response = await fetch("/api/push-subscription", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      endpoint: subscription.endpoint,
      user_agent: navigator.userAgent,
      keys: subscription.toJSON().keys,
    }),
  });

  if (!response.ok) {
    return;
  }

  const data = (await response.json()) as { id: number };
  const clients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  for (const client of clients) {
    client.postMessage({ type: "push-subscription-id", id: data.id });
  }
}

// The browser fires this when the push service invalidated the subscription
// (e.g. 410 Gone). Re-subscribe so notifications keep working in the
// background, without the app being open.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const vapidKey = await fetchVapidPublicKey();

      if (!vapidKey) {
        return;
      }

      try {
        const subscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        });
        await registerPushSubscription(subscription);
      } catch {
        // Repair failed; the app retries on its next load.
      }
    })(),
  );
});

self.addEventListener("push", (event) => {
  if (!event.data) {
    return;
  }

  try {
    const payload = event.data.json() as {
      title: string;
      body?: string;
      icon?: string;
      badge?: string;
      data?: { type?: string; gameId?: number; url?: string };
    };

    event.waitUntil(
      (async () => {
        if (await hasActiveClient()) {
          return;
        }

        if (payload.data?.gameId != null) {
          await preloadGameState(payload.data.gameId);
        }

        await self.registration.showNotification(payload.title, {
          body: payload.body,
          icon: payload.icon ?? "/static/images/icon-192.png",
          badge: payload.badge ?? "/static/images/icon-192.png",
          data: payload.data,
        });
      })(),
    );
  } catch {
    // Ignore malformed payloads
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data as { url?: string } | undefined;
  const targetUrl = new URL(data?.url ?? "/", self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then(async (clients) => {
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          await client.focus();

          if ("navigate" in client) {
            return client.navigate(targetUrl);
          }

          return;
        }
      }

      return self.clients.openWindow(targetUrl);
    }),
  );
});
