import { computed, signal } from "@preact/signals";

export type FlashSeverity = "error" | "warning" | "success" | "info";

export type FlashMessage = {
  message: string;
  severity: FlashSeverity;
};

const flashState = signal<FlashMessage | undefined>(undefined);

export const activeFlash = computed(() => flashState.value);
export const activeFlashMessage = computed(() => flashState.value?.message);

export function setFlash(message: string, severity: FlashSeverity = "error"): void {
  flashState.value = { message, severity };
}

export function setFlashState(flash: FlashMessage | undefined): void {
  if (!flash?.message) {
    flashState.value = undefined;
    return;
  }
  flashState.value = flash;
}

export function clearFlash(): void {
  flashState.value = undefined;
}

export function readFlashFromUrl(url: URL): FlashMessage | undefined {
  const message = url.searchParams.get("flash");
  if (!message) {
    return undefined;
  }
  const severity = normalizeSeverity(url.searchParams.get("flash_level"));
  return { message, severity };
}

export function stripFlashParams(url: URL): string {
  const next = new URL(url.toString());
  next.searchParams.delete("flash");
  next.searchParams.delete("flash_level");
  return `${next.pathname}${next.search}`;
}

function normalizeSeverity(level: string | null): FlashSeverity {
  switch (level) {
    case "warning":
    case "success":
    case "info":
      return level;
    default:
      return "error";
  }
}
