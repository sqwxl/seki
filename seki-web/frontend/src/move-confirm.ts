const KEY = "seki:moveConfirmation";

export function readMoveConfirmation(): boolean {
  const stored = localStorage.getItem(KEY);
  if (stored !== null) {
    return stored === "true";
  }
  return window.matchMedia("(max-width: 1024px)").matches;
}
