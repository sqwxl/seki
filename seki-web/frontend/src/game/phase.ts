import { signal, computed } from "@preact/signals";
import { presentationActive, presenterId, currentUserId } from "./state";

export type GamePhase =
  | { phase: "live" }
  | { phase: "analysis" }
  | { phase: "estimate"; fromAnalysis: boolean }
  | {
      phase: "presentation";
      role: "presenter" | "synced-viewer" | "local-analysis";
    };

export const gamePhase = signal<GamePhase>({ phase: "live" });

/** True when the user is in an analysis-capable mode (analysis, presenter, local-analysis). */
export const analysisMode = computed(() => isAnalysisCapable(gamePhase.value));

/** True when the user is in the score-estimate phase. */
export const estimateMode = computed(
  () => gamePhase.value.phase === "estimate",
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True for phases where analysis-style interaction is available. */
function isAnalysisCapable(p: GamePhase): boolean {
  return (
    p.phase === "analysis" ||
    (p.phase === "presentation" &&
      (p.role === "presenter" || p.role === "local-analysis"))
  );
}

// ---------------------------------------------------------------------------
// Transition functions
// ---------------------------------------------------------------------------

export function toAnalysis(): void {
  const cur = gamePhase.value;
  if (cur.phase === "analysis") {
    return;
  }
  // Allow from live, or from presentation-local-analysis (when presentation ends
  // but user was in personal analysis — they stay in analysis)
  if (
    cur.phase !== "live" &&
    !(cur.phase === "presentation" && cur.role === "local-analysis")
  ) {
    return;
  }
  gamePhase.value = { phase: "analysis" };
}

export function toLive(): void {
  const cur = gamePhase.value;
  if (cur.phase === "live") {
    return;
  }
  gamePhase.value = { phase: "live" };
}

export function toEstimate(): void {
  const cur = gamePhase.value;
  if (cur.phase === "estimate") {
    return;
  }
  const fromAnalysis = isAnalysisCapable(cur);
  if (cur.phase !== "live" && !fromAnalysis) {
    return;
  }
  gamePhase.value = { phase: "estimate", fromAnalysis };
}

export function exitEstimate(): void {
  const cur = gamePhase.value;
  if (cur.phase !== "estimate") {
    return;
  }
  if (cur.fromAnalysis) {
    // Restore to the correct analysis-capable phase
    if (presentationActive.value) {
      const isPresenting = presenterId.value === currentUserId.value;
      gamePhase.value = {
        phase: "presentation",
        role: isPresenting ? "presenter" : "local-analysis",
      };
    } else {
      gamePhase.value = { phase: "analysis" };
    }
  } else {
    gamePhase.value = { phase: "live" };
  }
}

export function toPresentation(role: "presenter" | "synced-viewer"): void {
  gamePhase.value = { phase: "presentation", role };
}

export function toPresentationLocalAnalysis(): void {
  const cur = gamePhase.value;
  if (cur.phase !== "presentation" || cur.role !== "synced-viewer") {
    return;
  }
  gamePhase.value = { phase: "presentation", role: "local-analysis" };
}

export function toPresentationSyncedViewer(): void {
  const cur = gamePhase.value;
  if (cur.phase !== "presentation" || cur.role !== "local-analysis") {
    return;
  }
  gamePhase.value = { phase: "presentation", role: "synced-viewer" };
}

export function exitPresentation(): void {
  const cur = gamePhase.value;
  if (cur.phase !== "presentation") {
    return;
  }
  gamePhase.value = { phase: "live" };
}

/** Reset to live phase (e.g. on reconnect or presentation end). */
export function resetPhase(): void {
  gamePhase.value = { phase: "live" };
}
