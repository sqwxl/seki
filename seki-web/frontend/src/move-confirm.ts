const KEY = "seki:moveConfirmation";

export function readMoveConfirmation(): boolean {
  const stored = localStorage.getItem(KEY);
  if (stored !== null) {
    return stored === "true";
  }
  return window.matchMedia("(max-width: 1024px)").matches;
}

export function setupMoveConfirmToggle(onChange: (enabled: boolean) => void): void {
  const cb = document.getElementById("toggle-move-confirm-btn") as HTMLInputElement | null;
  if (!cb) {
    return;
  }
  cb.checked = readMoveConfirmation();
  cb.addEventListener("change", () => {
    localStorage.setItem(KEY, String(cb.checked));
    onChange(cb.checked);
  });
}
