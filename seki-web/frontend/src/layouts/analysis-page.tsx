import type { ControlsProps } from "../components/controls-shared";
import { GameInfo } from "../components/game-info";
import { GameStatus } from "../components/game-status";
import { CapturesBlack, CapturesWhite, IconGrid3x3 } from "../components/icons";
import { TabBar } from "../components/tab-bar";
import type { AnalysisCapabilities } from "../game/capabilities";
import { analysisCapabilities } from "../game/capabilities";
import { playStoneSound } from "../game/sound";
import { GameStage } from "../game/types";
import { formatN } from "../utils/format";
import { useMediaQuery } from "../utils/media-query";
import type { MoveConfirmState } from "../utils/move-confirm";
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
  const compact = useMediaQuery("(max-width: 767px)");
  return <Controls {...buildAnalysisControls(caps, props)} compact={compact} />;
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
  const meta = analysisMeta.value;
  const hasMeta = !!meta;
  const metaGameSettings = meta
    ? {
        cols: meta.cols,
        rows: meta.rows,
        handicap: meta.handicap ?? 0,
        time_control: "none" as const,
        is_private: false,
        invite_only: false,
        main_time_secs: undefined as number | undefined,
        increment_secs: undefined as number | undefined,
        byoyomi_time_secs: undefined as number | undefined,
        byoyomi_periods: undefined as number | undefined,
      }
    : {
        cols: 19,
        rows: 19,
        handicap: 0,
        time_control: "none" as const,
        is_private: false,
        invite_only: false,
        main_time_secs: undefined as number | undefined,
        increment_secs: undefined as number | undefined,
        byoyomi_time_secs: undefined as number | undefined,
        byoyomi_periods: undefined as number | undefined,
      };

  return (
    <GamePageLayout
      header={undefined}
      gobanRef={gobanRef}
      gobanStyle={`aspect-ratio: ${size}/${size}`}
      playerTop={<AnalysisTopPanel />}
      playerBottom={<AnalysisBottomPanel />}
      controls={<AnalysisControlsSlot {...props} />}
      status={
        statusText || hasMeta ? (
          <GameStatus text={statusText || " "}>
            {hasMeta && meta && (
              <GameInfo
                settings={metaGameSettings}
                komi={meta.komi ?? 6.5}
                stage={GameStage.Completed}
                moveCount={0}
                result={meta.result}
                black={
                  meta.black_name
                    ? {
                        id: 0,
                        display_name: meta.black_name,
                        is_registered: false,
                        email: undefined,
                        preferences: { rating_display: "kyu_dan" as const },
                        is_bot: undefined,
                        rank: null,
                      }
                    : undefined
                }
                white={
                  meta.white_name
                    ? {
                        id: 0,
                        display_name: meta.white_name,
                        is_registered: false,
                        email: undefined,
                        preferences: { rating_display: "kyu_dan" as const },
                        is_bot: undefined,
                        rank: null,
                      }
                    : undefined
                }
                capturesBlack={0}
                capturesWhite={0}
                territory={undefined}
                settledTerritory={undefined}
                estimateScore={undefined}
                copyInviteLink={() => {}}
              />
            )}
          </GameStatus>
        ) : undefined
      }
      moveTree={<AnalysisMoveTree moveTreeEl={moveTreeEl} />}
      tabBar={<AnalysisTabBar {...props} />}
    />
  );
}
