import type { ControlsProps } from "../components/controls-shared";
import { GameStatus } from "../components/game-status";
import { CapturesBlack, CapturesWhite, IconGrid3x3 } from "../components/icons";
import { TabBar } from "../components/tab-bar";
import type { AnalysisCapabilities } from "../game/capabilities";
import { analysisCapabilities } from "../game/capabilities";
import { playStoneSound } from "../game/sound";
import {
  blackSymbol,
  formatN,
  formatSgfTime,
  formatSize,
  whiteSymbol,
} from "../utils/format";
import type { MoveConfirmState } from "../utils/move-confirm";
import type { SgfMeta } from "../utils/sgf";
import {
  analysisBoard,
  analysisKomi,
  analysisMeta,
  analysisNavState,
  analysisPanelState,
  analysisPendingMove,
  analysisSize,
} from "./analysis-state";
import { Controls } from "./controls";
import { GamePageLayout } from "./game-page-layout";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSgfDescription(meta: SgfMeta): string {
  const b = meta.black_name ?? "Black";
  const w = meta.white_name ?? "White";
  const parts: string[] = [
    `${b} ${blackSymbol()} vs ${w} ${whiteSymbol()}`,
    formatSize(meta.cols, meta.rows),
  ];

  if (meta.handicap && meta.handicap >= 2) {
    parts.push(`H${meta.handicap}`);
  }

  const tc = formatSgfTime(meta.time_limit_secs, meta.overtime);

  if (tc) {
    parts.push(tc);
  }

  if (meta.result) {
    parts.push(meta.result);
  }

  return parts.join(" - ");
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function AnalysisHeader() {
  const meta = analysisMeta.value;

  return <>{meta && <p>{formatSgfDescription(meta)}</p>}</>;
}

function buildAnalysisControls(
  caps: AnalysisCapabilities,
  props: AnalysisPageProps,
): ControlsProps {
  const { mc, onSizeChange, onKomiChange, handleSgfImport, handleSgfExport } =
    props;
  const board = analysisBoard.value;
  const nav = analysisNavState.value;

  const controlsProps: ControlsProps = {
    layout:
      caps.showTerritoryReady || caps.showTerritoryExit
        ? "analysis-review"
        : "analysis",
    nav: {
      atStart: nav.atStart,
      atLatest: nav.atLatest,
      atMainEnd: nav.atMainEnd,
      counter: nav.counter,
      onNavigate: (action) => board?.navigate(action),
    },
    sizeSelect: {
      value: analysisSize.value,
      options: [9, 13, 19],
      onChange: onSizeChange,
    },
    komiSelect: {
      value: analysisKomi.value,
      onChange: onKomiChange,
    },
  };

  // Territory review controls
  if (caps.showTerritoryReady) {
    controlsProps.territoryReady = {
      onClick: () => board?.finalizeTerritoryReview(),
    };
  }

  if (caps.showTerritoryExit) {
    controlsProps.territoryExit = {
      onClick: () => board?.exitTerritoryReview(),
    };
  }

  // Play controls (hidden during territory review, disabled on finalized nodes)
  if (caps.canPass) {
    controlsProps.pass = { onClick: () => board?.pass() };
  }

  if (caps.showEstimate) {
    controlsProps.estimate = {
      onClick: () => board?.enterTerritoryReview(),
      disabled: !caps.canEstimate,
    };
  }

  if (caps.showSgfImport) {
    controlsProps.sgfImport = { onFileChange: handleSgfImport };
  }

  if (caps.showSgfExport) {
    controlsProps.sgfExport = { onClick: handleSgfExport };
  }

  // Confirm move (ephemeral)
  if (analysisPendingMove.value) {
    controlsProps.confirmMove = {
      onClick: () => {
        if (analysisPendingMove.value && board) {
          const [col, row] = analysisPendingMove.value;

          mc.clear();
          analysisPendingMove.value = undefined;

          if (board.engine.try_play(col, row)) {
            playStoneSound();
            board.save();
            board.render();
          }
        }
      },
    };
  }

  return controlsProps;
}

function AnalysisPanel({
  panel,
}: {
  panel: (typeof analysisPanelState.value)["top"];
}) {
  if (!panel) {
    return null;
  }

  return (
    <>
      <span class="player-name-group">
        <span class="user-label">{panel.label}</span>
      </span>
      <span class={`player-clock${panel.clockLowTime ? " low-time" : ""}`}>
        {panel.clock ?? ""}
      </span>
      <span class="player-captures">
        <>
          {panel.territory != null && (
            <>
              {panel.territory}
              <span class="territory-icon">
                <IconGrid3x3 title="Territory" />
              </span>
            </>
          )}
          {formatN(panel.captures)}
          {panel.komi ? `+${formatN(panel.komi)}` : ""}
          <span class="captures-icon">
            {panel.stone === "black" ? (
              <CapturesBlack title="Captures" />
            ) : (
              <CapturesWhite title="Captures" />
            )}
          </span>
        </>
      </span>
    </>
  );
}

function AnalysisTopPanel() {
  return <AnalysisPanel panel={analysisPanelState.value.top} />;
}

function AnalysisBottomPanel() {
  return <AnalysisPanel panel={analysisPanelState.value.bottom} />;
}

function AnalysisControlsSlot(props: AnalysisPageProps) {
  const caps = analysisCapabilities.value;
  return <Controls {...buildAnalysisControls(caps, props)} />;
}

function AnalysisMoveTree({ moveTreeEl }: { moveTreeEl: HTMLElement }) {
  return (
    <div
      class="move-tree-slot"
      ref={(el) => {
        if (el && !el.contains(moveTreeEl)) {
          el.appendChild(moveTreeEl);
        }
      }}
    />
  );
}

function AnalysisTabBar(props: AnalysisPageProps) {
  const caps = analysisCapabilities.value;
  return <TabBar controls={buildAnalysisControls(caps, props)} />;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export type AnalysisPageProps = {
  gobanRef: preact.Ref<HTMLDivElement>;
  mc: MoveConfirmState;
  moveTreeEl: HTMLElement;
  onSizeChange: (size: number) => void;
  onKomiChange: (komi: number) => void;
  handleSgfImport: (input: HTMLInputElement) => void;
  handleSgfExport: () => void;
};

export function AnalysisPage(props: AnalysisPageProps) {
  const { gobanRef, moveTreeEl } = props;
  const caps = analysisCapabilities.value;
  const size = analysisSize.value;

  const statusText = caps.statusText;

  return (
    <GamePageLayout
      header={<AnalysisHeader />}
      gobanRef={gobanRef}
      gobanStyle={`aspect-ratio: ${size}/${size}`}
      playerTop={<AnalysisTopPanel />}
      playerBottom={<AnalysisBottomPanel />}
      controls={<AnalysisControlsSlot {...props} />}
      status={statusText ? <GameStatus text={statusText} /> : undefined}
      moveTree={<AnalysisMoveTree moveTreeEl={moveTreeEl} />}
      tabBar={<AnalysisTabBar {...props} />}
    />
  );
}
