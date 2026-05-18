// @ts-nocheck -- ServiceWorkerGlobalScope types
const CACHE_NAME = "seki-v4";
const NETWORK_ONLY_PATHS = ["/static/css/", "/static/dist/", "/static/wasm/"];
const CACHE_FIRST_PATHS = ["/static/images/", "/static/sounds/"];

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
  return [...NETWORK_ONLY_PATHS, ...CACHE_FIRST_PATHS].some((p) =>
    url.pathname.startsWith(p),
  );
}

function isNetworkOnlyAsset(url: URL): boolean {
  return NETWORK_ONLY_PATHS.some((p) => url.pathname.startsWith(p));
}

function isApiRequest(url: URL): boolean {
  return url.pathname.startsWith("/api/");
}

function isSameTarget(clientUrl: string, targetUrl: URL): boolean {
  const url = new URL(clientUrl);

  return (
    url.origin === targetUrl.origin &&
    url.pathname === targetUrl.pathname &&
    (!targetUrl.search || url.search === targetUrl.search)
  );
}

async function hasActiveTargetClient(targetUrl: URL): Promise<boolean> {
  const clients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  return clients.some((client) => {
    if (!isSameTarget(client.url, targetUrl)) {
      return false;
    }

    return client.focused || client.visibilityState === "visible";
  });
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

  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request));
    return;
  }

  if (isStaticAsset(url)) {
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
        const targetUrl = new URL(
          payload.data?.url ?? "/",
          self.location.origin,
        );

        if (await hasActiveTargetClient(targetUrl)) {
          return;
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
