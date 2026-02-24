import {
  setIcon,
  themeLightSvg,
  themeDarkSvg,
  themeAutoSvg,
} from "../components/icons";
import { storage, THEME } from "./storage";

type ThemeMode = "auto" | "light" | "dark";

const TOGGLE_ID = "theme-toggle";
const darkQuery = matchMedia("(prefers-color-scheme: dark)");

const NEXT: Record<ThemeMode, ThemeMode> = {
  auto: "light",
  light: "dark",
  dark: "auto",
};

const ICONS: Record<ThemeMode, string> = {
  light: themeLightSvg,
  dark: themeDarkSvg,
  auto: themeAutoSvg,
};

const TITLES: Record<ThemeMode, string> = {
  auto: "Switch to light theme",
  light: "Switch to dark theme",
  dark: "Switch to auto theme",
};

function getMode(): ThemeMode {
  const stored = storage.get(THEME);
  if (stored === "light" || stored === "dark") {
    return stored;
  }
  return "auto";
}

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

function updateToggle(mode: ThemeMode): void {
  setIcon(TOGGLE_ID, ICONS[mode]);
  const btn = document.getElementById(TOGGLE_ID);
  if (btn) {
    btn.title = TITLES[mode];
  }
}

export function initThemeToggle(): void {
  const mode = getMode();
  applyTheme(mode);
  updateToggle(mode);

  const btn = document.getElementById(TOGGLE_ID);
  if (!btn) {
    return;
  }

  btn.addEventListener("click", () => {
    const current = getMode();
    const next = NEXT[current];
    storage.set(THEME, next);
    applyTheme(next);
    updateToggle(next);
  });
}

// When system preference changes and mode is auto, update the effective theme
darkQuery.addEventListener("change", () => {
  if (getMode() === "auto") {
    applyTheme("auto");
  }
});
