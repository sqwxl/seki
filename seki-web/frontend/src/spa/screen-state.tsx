import { useEffect, useState } from "preact/hooks";

const DYNAMIC_IMPORT_RELOAD_KEY = "seki:dynamic-import-reload";
const DYNAMIC_IMPORT_ERROR_PATTERNS = [
  "Failed to fetch dynamically imported module",
  "Importing a module script failed",
  "error loading dynamically imported module",
];

export function ErrorState({ message }: { message: string }) {
  return <p>{message}</p>;
}

export function LoadingState() {
  return <p>Loading...</p>;
}

function isDynamicImportError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);

  return DYNAMIC_IMPORT_ERROR_PATTERNS.some((pattern) =>
    message.toLowerCase().includes(pattern.toLowerCase()),
  );
}

function hasReloadedAfterDynamicImportError() {
  try {
    return sessionStorage.getItem(DYNAMIC_IMPORT_RELOAD_KEY) === "1";
  } catch {
    return false;
  }
}

function markDynamicImportReload() {
  try {
    sessionStorage.setItem(DYNAMIC_IMPORT_RELOAD_KEY, "1");
  } catch {
    // Ignore storage failures; the reload still gives the browser a fresh asset graph.
  }
}

function clearDynamicImportReload() {
  try {
    sessionStorage.removeItem(DYNAMIC_IMPORT_RELOAD_KEY);
  } catch {
    // Ignore storage failures.
  }
}

async function clearServiceWorkerCaches() {
  if (!("caches" in window)) {
    return;
  }

  const keys = await caches.keys();

  await Promise.all(
    keys
      .filter((key) => key.startsWith("seki-"))
      .map((key) => caches.delete(key)),
  );
}

async function recoverFromDynamicImportError(err: unknown) {
  if (!isDynamicImportError(err) || hasReloadedAfterDynamicImportError()) {
    return false;
  }

  markDynamicImportReload();

  try {
    await clearServiceWorkerCaches();
  } finally {
    window.location.reload();
  }

  return true;
}

export function useLazyModule<T>(loader: () => Promise<T>) {
  const [mod, setMod] = useState<T | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;

    loader()
      .then((next) => {
        if (!cancelled) {
          clearDynamicImportReload();
          setMod(next);
        }
      })
      .catch(async (err: Error) => {
        if (cancelled || (await recoverFromDynamicImportError(err))) {
          return;
        }

        setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [loader]);

  return { mod, error };
}
