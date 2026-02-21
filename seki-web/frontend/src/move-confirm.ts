const KEY = "seki:moveConfirmation";

export function readMoveConfirmation(): boolean {
  const stored = localStorage.getItem(KEY);
  if (stored !== null) {
    return stored === "true";
  }
  return window.matchMedia("(max-width: 1024px)").matches;
}

function updateLabel(btn: HTMLElement, enabled: boolean): void {
  btn.textContent = enabled ? "➁" : "➀";
  btn.title = enabled ? "Move confirmation: ON (click to disable)" : "Move confirmation: OFF (click to enable)";
}

export function setupMoveConfirmToggle(onChange: (enabled: boolean) => void): void {
  const btn = document.getElementById("toggle-move-confirm-btn");
  if (!btn) {
    return;
  }
  let enabled = readMoveConfirmation();
  updateLabel(btn, enabled);
  btn.addEventListener("click", () => {
    enabled = !enabled;
    localStorage.setItem(KEY, String(enabled));
    updateLabel(btn, enabled);
    onChange(enabled);
  });
}
