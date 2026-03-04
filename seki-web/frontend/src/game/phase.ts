import { signal, batch } from "@preact/signals";
import { analysisMode, estimateMode, presentationActive } from "./state";

export type GamePhase =
  | { phase: "live" }
  | { phase: "analysis" }
  | { phase: "estimate"; fromAnalysis: boolean }
  | {
      phase: "presentation";
      role: "presenter" | "synced-viewer" | "local-analysis";
    };

export const gamePhase = signal<GamePhase>({ phase: "live" });

// --- Transition functions ---
// Each validates the current phase and dual-writes to old booleans
// for backwards compatibility during migration.

export function toAnalysis(): void {
  const cur = gamePhase.value;
  if (cur.phase !== "live") {
    return;
  }
  batch(() => {
    gamePhase.value = { phase: "analysis" };
    analysisMode.value = true;
  });
}

export function toLive(): void {
  const cur = gamePhase.value;
  if (cur.phase === "live") {
    return;
  }
  batch(() => {
    gamePhase.value = { phase: "live" };
    analysisMode.value = false;
    estimateMode.value = false;
  });
}

export function toEstimate(): void {
  const cur = gamePhase.value;
  if (cur.phase !== "live" && cur.phase !== "analysis") {
    return;
  }
  batch(() => {
    gamePhase.value = {
      phase: "estimate",
      fromAnalysis: cur.phase === "analysis",
    };
    estimateMode.value = true;
  });
}

export function exitEstimate(): void {
  const cur = gamePhase.value;
  if (cur.phase !== "estimate") {
    return;
  }
  batch(() => {
    estimateMode.value = false;
    if (cur.fromAnalysis) {
      gamePhase.value = { phase: "analysis" };
    } else {
      gamePhase.value = { phase: "live" };
    }
  });
}

export function toPresentation(role: "presenter" | "synced-viewer"): void {
  batch(() => {
    gamePhase.value = { phase: "presentation", role };
    presentationActive.value = true;
    if (role === "presenter") {
      analysisMode.value = true;
    }
  });
}

export function toPresentationLocalAnalysis(): void {
  const cur = gamePhase.value;
  if (cur.phase !== "presentation" || cur.role !== "synced-viewer") {
    return;
  }
  batch(() => {
    gamePhase.value = { phase: "presentation", role: "local-analysis" };
    analysisMode.value = true;
  });
}

export function toPresentationSyncedViewer(): void {
  const cur = gamePhase.value;
  if (cur.phase !== "presentation" || cur.role !== "local-analysis") {
    return;
  }
  batch(() => {
    gamePhase.value = { phase: "presentation", role: "synced-viewer" };
    analysisMode.value = false;
  });
}

export function exitPresentation(): void {
  const cur = gamePhase.value;
  if (cur.phase !== "presentation") {
    return;
  }
  batch(() => {
    gamePhase.value = { phase: "live" };
    presentationActive.value = false;
    analysisMode.value = false;
    estimateMode.value = false;
  });
}

/** Reset to live phase (e.g. on new game state that invalidates current mode). */
export function resetPhase(): void {
  batch(() => {
    gamePhase.value = { phase: "live" };
    analysisMode.value = false;
    estimateMode.value = false;
    presentationActive.value = false;
  });
}
