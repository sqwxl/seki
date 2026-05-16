import { useEffect, useState } from "preact/hooks";
import type { BootstrapPayload, FetchError } from "./types";

declare global {
  interface Window {
    __sekiBootstrap?: BootstrapPayload;
  }
}

const routeDataCache = new Map<string, unknown>();
const inflightRouteData = new Map<string, Promise<unknown>>();

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === "string"
        ? payload
        : (payload?.error ?? payload?.message ?? "Request failed");
    throw { status: response.status, message } satisfies FetchError;
  }

  return payload as T;
}

export function getBootstrapData(): BootstrapPayload | undefined {
  if (window.__sekiBootstrap) {
    return window.__sekiBootstrap;
  }
  const el = document.getElementById("bootstrap-data");
  if (!el?.textContent) {
    return;
  }
  const payload = JSON.parse(el.textContent) as BootstrapPayload;
  window.__sekiBootstrap = payload;
  return payload;
}

export function seedBootstrapCache(): void {
  const payload = getBootstrapData();
  if (payload?.url && payload.data !== undefined) {
    routeDataCache.set(payload.url, payload.data);
  }
}

export function clearRouteDataCache(): void {
  routeDataCache.clear();
  inflightRouteData.clear();
}

export function invalidateRouteData(url: string): void {
  routeDataCache.delete(url);
  inflightRouteData.delete(url);
}

async function fetchRouteData<T>(url: string): Promise<T> {
  if (routeDataCache.has(url)) {
    return routeDataCache.get(url) as T;
  }
  const inflight = inflightRouteData.get(url);
  if (inflight) {
    return (await inflight) as T;
  }
  const request = fetchJson<T>(url)
    .then((data) => {
      routeDataCache.set(url, data);
      inflightRouteData.delete(url);
      return data;
    })
    .catch((err) => {
      inflightRouteData.delete(url);
      throw err;
    });
  inflightRouteData.set(url, request as Promise<unknown>);
  return request;
}

export function prefetchRouteData(url: string | undefined): void {
  if (!url || routeDataCache.has(url) || inflightRouteData.has(url)) {
    return;
  }
  void fetchRouteData(url);
}

export function useRouteData<T>(url: string) {
  const [data, setData] = useState<T | undefined>(
    () => routeDataCache.get(url) as T | undefined,
  );
  const [error, setError] = useState<FetchError | undefined>();

  useEffect(() => {
    let cancelled = false;
    const cached = routeDataCache.get(url) as T | undefined;
    setData(cached);
    setError(undefined);
    fetchRouteData<T>(url)
      .then((next) => {
        if (!cancelled) {
          setData(next);
        }
      })
      .catch((err: FetchError) => {
        if (!cancelled) {
          setError(err);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return { data, error };
}
