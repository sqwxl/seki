import { signal } from "@preact/signals";
import { storage, THEME } from "./storage";

export type ThemeMode = "auto" | "light" | "dark";

const darkQuery = matchMedia("(prefers-color-scheme: dark)");

const NEXT: Record<ThemeMode, ThemeMode> = {
  auto: "light",
  light: "dark",
  dark: "auto",
};

const LABELS: Record<ThemeMode, string> = {
  auto: "Auto",
  light: "Light",
  dark: "Dark",
};

export function getMode(): ThemeMode {
  const stored = storage.get(THEME);
  if (stored === "light" || stored === "dark") {
    return stored;
  }
  return "auto";
}

export const themeMode = signal<ThemeMode>(getMode());

function resolve(mode: ThemeMode): "light" | "dark" {
  if (mode === "light") {
    return "light";
  }
  if (mode === "dark") {
    return "dark";
  }
  return darkQuery.matches ? "dark" : "light";
}

function applyTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = resolve(mode);
  document.documentElement.dispatchEvent(new Event("themechange"));
}

export function getThemeLabel(mode: ThemeMode): string {
  return LABELS[mode];
}

export function cycleTheme(): void {
  const next = NEXT[themeMode.value];
  storage.set(THEME, next);
  themeMode.value = next;
  applyTheme(next);
}

export function initTheme(): void {
  applyTheme(themeMode.value);
}

// When system preference changes and mode is auto, update the effective theme
darkQuery.addEventListener("change", () => {
  if (getMode() === "auto") {
    applyTheme("auto");
  }
});
