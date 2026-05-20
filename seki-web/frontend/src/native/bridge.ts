export function isNativeApp(): boolean {
  return typeof window !== "undefined" && "SekiBridge" in window;
}

export function getFcmToken(): string | undefined {
  if (!isNativeApp()) {
    return undefined;
  }

  try {
    const bridge = (
      window as unknown as { SekiBridge: { getFcmToken(): string } }
    ).SekiBridge;
    const token = bridge.getFcmToken();
    return token || undefined;
  } catch {
    return undefined;
  }
}

export function onBridgeReady(callback: () => void): void {
  if (!isNativeApp()) {
    return;
  }

  if ((window as unknown as { SekiBridgeReady?: boolean }).SekiBridgeReady) {
    callback();
    return;
  }

  document.addEventListener("sekibridge-ready", () => callback(), {
    once: true,
  });
}

export function onFcmPushReceived(
  handler: (data: { title: string; body?: string; url?: string }) => void,
): void {
  if (!isNativeApp()) {
    return;
  }

  window.addEventListener("sekifcm-push", (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (detail) {
      handler(detail);
    }
  });
}

export function onLifecycleEvent(
  handler: (event: "foreground" | "background") => void,
): void {
  if (!isNativeApp()) {
    return;
  }

  window.addEventListener("sekilifecycle", (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (detail === "foreground" || detail === "background") {
      handler(detail);
    }
  });
}
