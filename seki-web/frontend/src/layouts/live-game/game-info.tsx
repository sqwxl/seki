import {
  gamePhase,
  toAnalysis,
  toLive,
  toPresentation,
} from "../../game/phase";
import {
  analysisMode,
  board,
  currentUserId,
  estimateMode,
  estimateScore,
  isPresenter,
  moves,
} from "../../game/state";
import { storage } from "../../utils/storage";

export function buildWebSocketDeps(params: {
  clearPendingMove: () => void;
  moveTreeEl: HTMLElement;
  analysisKey: string;
  lastPresentationSnapshot: () => string;
  setLastPresentationSnapshot: (v: string) => void;
  saveAnalysis: (active?: boolean) => void;
  exitAnalysis: () => void;
  restoreAnalysisPosition: () => void;
}) {
  const {
    clearPendingMove,
    moveTreeEl,
    analysisKey,
    lastPresentationSnapshot: getSnapshot,
    setLastPresentationSnapshot: setSnapshot,
    saveAnalysis: doSaveAnalysis,
    exitAnalysis: doExitAnalysis,
    restoreAnalysisPosition: doRestoreAnalysisPosition,
  } = params;

  return {
    onPresentationStarted: (snapshot: string) => {
      if (isPresenter.value) {
        clearPendingMove();
        toPresentation("presenter");
        doRestoreAnalysisPosition();
        board.value?.setMoveTreeEl(moveTreeEl);
      } else {
        const wasInEstimate = estimateMode.value;
        const wasInAnalysis = analysisMode.value;
        if (wasInEstimate) {
          estimateScore.value = undefined;
          board.value?.exitTerritoryReview();
        }
        if (wasInAnalysis) {
          clearPendingMove();
          doSaveAnalysis();
        }
        toPresentation("synced-viewer");
        if (snapshot) {
          setSnapshot(snapshot);
          board.value?.importSnapshot(snapshot);
        }
      }
      board.value?.render();
    },
    onPresentationEnded: (wasPresenter: boolean) => {
      setSnapshot("");
      if (wasPresenter) {
        doExitAnalysis();
      } else {
        const cur = gamePhase.value;
        if (cur.phase === "presentation" && cur.role === "local-analysis") {
          toAnalysis();
        } else {
          toLive();
          if (board.value) {
            board.value.updateBaseMoves(JSON.stringify(moves.value));
            board.value.navigate("end");
            board.value.render();
          }
        }
      }
    },
    onPresentationUpdate: (snapshot: string) => {
      setSnapshot(snapshot);
      if (!isPresenter.value && !analysisMode.value) {
        board.value?.importSnapshot(snapshot);
        try {
          const parsed = JSON.parse(snapshot) as {
            tree?: string;
            activeNodeId?: string;
          };
          if (parsed.tree) {
            storage.setJson(analysisKey, {
              tree: parsed.tree,
              nodeId: parseInt(parsed.activeNodeId ?? "-1", 10),
            });
          }
        } catch {
          // Ignore parse failures
        }
      }
    },
    onControlChanged: (newPresenterId: number) => {
      if (newPresenterId === currentUserId.value) {
        const wasAnalysis = analysisMode.value;
        toPresentation("presenter");
        if (!wasAnalysis) {
          clearPendingMove();
          doRestoreAnalysisPosition();
          board.value?.setMoveTreeEl(moveTreeEl);
        }
      } else {
        const wasInEstimate = estimateMode.value;
        if (wasInEstimate) {
          estimateScore.value = undefined;
          board.value?.exitTerritoryReview();
        }
        clearPendingMove();
        doSaveAnalysis();
        toPresentation("synced-viewer");
        if (getSnapshot() && board.value) {
          board.value.importSnapshot(getSnapshot());
        }
      }
      board.value?.render();
    },
  };
}
