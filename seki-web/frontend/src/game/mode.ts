import { computed, signal } from "@preact/signals";
import { currentUserId, presentationActive, presenterId } from "./state";

export type GameMode =
  | { mode: "live" }
  | { mode: "analysis" }
  | { mode: "estimate"; fromAnalysis: boolean }
  | {
      mode: "presentation";
      role: "presenter" | "synced-viewer" | "local-analysis";
    };

export const gameMode = signal<GameMode>({ mode: "live" });

/** True when the user is in an analysis-capable mode (analysis, presenter, local-analysis). */
export const analysisMode = computed(() => isAnalysisCapable(gameMode.value));

/** True when the user is in the score-estimate mode. */
export const estimateMode = computed(() => gameMode.value.mode === "estimate");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True for modes where analysis-style interaction is available. */
function isAnalysisCapable(p: GameMode): boolean {
  return (
    p.mode === "analysis" ||
    (p.mode === "presentation" &&
      (p.role === "presenter" || p.role === "local-analysis"))
  );
}

// ---------------------------------------------------------------------------
// Transition functions
// ---------------------------------------------------------------------------

export function toAnalysis(): void {
  const cur = gameMode.value;

  if (cur.mode === "analysis") {
    return;
  }
  // Allow from live, or from presentation-local-analysis (when presentation ends
  // but user was in personal analysis — they stay in analysis)
  if (
    cur.mode !== "live" &&
    !(cur.mode === "presentation" && cur.role === "local-analysis")
  ) {
    return;
  }

  gameMode.value = { mode: "analysis" };
}

export function toLive(): void {
  const cur = gameMode.value;

  if (cur.mode === "live") {
    return;
  }

  gameMode.value = { mode: "live" };
}

export function toEstimate(): void {
  const cur = gameMode.value;

  if (cur.mode === "estimate") {
    return;
  }

  const fromAnalysis = isAnalysisCapable(cur);

  if (cur.mode !== "live" && !fromAnalysis) {
    return;
  }

  gameMode.value = { mode: "estimate", fromAnalysis };
}

export function exitEstimate(): void {
  const cur = gameMode.value;

  if (cur.mode !== "estimate") {
    return;
  }

  if (cur.fromAnalysis) {
    // Restore to the correct analysis-capable mode
    if (presentationActive.value) {
      const isPresenting = presenterId.value === currentUserId.value;
      gameMode.value = {
        mode: "presentation",
        role: isPresenting ? "presenter" : "local-analysis",
      };
    } else {
      gameMode.value = { mode: "analysis" };
    }
  } else {
    gameMode.value = { mode: "live" };
  }
}

export function toPresentation(role: "presenter" | "synced-viewer"): void {
  gameMode.value = { mode: "presentation", role };
}

export function toPresentationLocalAnalysis(): void {
  const cur = gameMode.value;

  if (cur.mode !== "presentation" || cur.role !== "synced-viewer") {
    return;
  }

  gameMode.value = { mode: "presentation", role: "local-analysis" };
}

export function toPresentationSyncedViewer(): void {
  const cur = gameMode.value;

  if (cur.mode !== "presentation" || cur.role !== "local-analysis") {
    return;
  }

  gameMode.value = { mode: "presentation", role: "synced-viewer" };
}

export function exitPresentation(): void {
  const cur = gameMode.value;

  if (cur.mode !== "presentation") {
    return;
  }

  gameMode.value = { mode: "live" };
}

/** Reset to live mode (e.g. on reconnect or presentation end). */
export function resetMode(): void {
  gameMode.value = { mode: "live" };
}
