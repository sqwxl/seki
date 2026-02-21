import type { Board } from "./board";

const COORDS_KEY = "seki:showCoordinates";

export function readShowCoordinates(): boolean {
  return localStorage.getItem(COORDS_KEY) === "true";
}

export function setupCoordToggle(getBoard: () => Board | undefined): void {
  const btn = document.getElementById("toggle-coords-btn");
  if (!btn) {
    return;
  }
  btn.addEventListener("click", () => {
    const next = localStorage.getItem(COORDS_KEY) !== "true";
    localStorage.setItem(COORDS_KEY, String(next));
    getBoard()?.setShowCoordinates(next);
  });
}
