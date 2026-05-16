// @ts-nocheck -- ServiceWorkerGlobalScope types
const CACHE_NAME = "seki-v1";
const STATIC_PATHS = [
  "/static/dist/",
  "/static/css/",
  "/static/wasm/",
  "/static/images/",
  "/static/sounds/",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.add("/").catch(() => {
        // Shell page may not be cacheable on first load; ok
      });
    }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
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
  return STATIC_PATHS.some((p) => url.pathname.startsWith(p));
}

function isApiRequest(url: URL): boolean {
  return url.pathname.startsWith("/api/");
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== "GET") {
    return;
  }

  if (isApiRequest(url)) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ error: "offline" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const fetched = fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
        return cached ?? fetched;
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
      self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: payload.icon ?? "/static/images/icon-192.png",
        badge: payload.badge ?? "/static/images/icon-192.png",
        data: payload.data,
      }),
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
