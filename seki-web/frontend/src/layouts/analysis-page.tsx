import {
  QuickConfirmButton,
  type ControlsProps,
} from "../components/controls-shared";
import { GameInfo } from "../components/game-info";
import { GameStatus } from "../components/game-status";
import {
  IconGrid4x4,
  IconKomi,
  IconRefresh,
  IconSettings,
  IconStonesBw,
} from "../components/icons";
import { PlayerPanel } from "../components/player-panel";
import { TabBar, type TabDef } from "../components/tab-bar";
import type { AnalysisCapabilities } from "../game/capabilities";
import { analysisCapabilities } from "../game/capabilities";
import { GameStage } from "../game/types";
import { useIsMobile } from "../utils/media-query";
import type { MoveConfirmState } from "../utils/move-confirm";
import {
  analysisAiState,
  analysisAiTerritoryState,
  analysisBoard,
  analysisKomi,
  analysisMeta,
  analysisNavState,
  analysisPanelState,
  analysisPendingMove,
  analysisSize,
  analysisTab,
  analysisTerritoryInfo,
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
    controlsProps.pass = { onClick: props.onPass };
  }

  if (caps.showEstimate) {
    const estimateActive =
      (analysisTerritoryInfo.value.estimating &&
        !analysisTerritoryInfo.value.confirming) ||
      analysisAiTerritoryState.value.mode === "estimate";

    controlsProps.estimate = {
      onClick: props.onEstimate,
      disabled: !caps.canEstimate && !estimateActive,
      active: estimateActive,
      pending: analysisAiTerritoryState.value.pending,
    };
  }

  controlsProps.aiSuggest = {
    onClick: props.onAiSuggestChange,
    disabled: !board || analysisSize.value !== 9 || !caps.canPlayMove,
    active: analysisAiState.value.enabled,
    pending: analysisAiState.value.pending,
    title:
      analysisSize.value === 9 ? "AI suggestion" : "AI suggestion requires 9x9",
  };

  if (analysisPendingMove.value) {
    controlsProps.confirmMove = {
      onClick: props.onConfirmMove,
    };
  }

  return controlsProps;
}

function AnalysisTopPanel() {
  const panel = analysisPanelState.value.top;
  return panel ? <PlayerPanel {...panel} /> : null;
}

function AnalysisBottomPanel() {
  const panel = analysisPanelState.value.bottom;
  return panel ? <PlayerPanel {...panel} /> : null;
}

function AnalysisControlsSlot(props: AnalysisPageProps) {
  const caps = analysisCapabilities.value;
  const isMobile = useIsMobile();
  return (
    <Controls {...buildAnalysisControls(caps, props)} compact={isMobile} />
  );
}

function AnalysisMoveTree({ moveTreeEl }: { moveTreeEl: HTMLElement }) {
  const isMobile = useIsMobile();
  const visible = !isMobile || analysisTab.value === "board";

  return (
    <div
      class={`move-tree-slot${!visible ? " hidden" : ""}`}
      ref={(el) => {
        if (el && !el.contains(moveTreeEl)) {
          el.appendChild(moveTreeEl);
        }
      }}
    />
  );
}

function AnalysisSettingsPanel(props: AnalysisPageProps) {
  return (
    <form class="analysis-settings" onSubmit={(e) => e.preventDefault()}>
      <div>
        <label for="analysis_size">
          <IconGrid4x4 /> Board size
        </label>
        <select
          id="analysis_size"
          value={analysisSize.value}
          onChange={(e) =>
            props.onSizeChange(parseInt(e.currentTarget.value, 10))
          }
        >
          {[9, 13, 19].map((s) => (
            <option key={s} value={s}>
              {s}×{s}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label for="analysis_komi">
          <IconKomi /> Komi
        </label>
        <input
          id="analysis_komi"
          type="number"
          value={analysisKomi.value}
          min={-100.5}
          max={100.5}
          step={0.5}
          onChange={(e) =>
            props.onKomiChange(parseFloat(e.currentTarget.value) || 0)
          }
        />
      </div>
      <div>
        <QuickConfirmButton
          id="analysis-reset"
          icon={IconRefresh}
          label="Reset"
          title="Reset board"
          confirm={{
            onConfirm: props.onReset,
          }}
        />
      </div>
    </form>
  );
}

const analysisTabs: TabDef[] = [
  { id: "board", label: "Board", icon: IconStonesBw },
  { id: "settings", label: "Settings", icon: IconSettings },
];

function AnalysisTabBar() {
  return <TabBar tabs={analysisTabs} active={analysisTab} />;
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
  onReset: () => void;
  onAiSuggestChange: () => void;
  onEstimate: () => void;
  onConfirmMove: () => void;
  onPass: () => void;
};

function AnalysisAiStatus() {
  const territory = analysisAiTerritoryState.value;
  const showEstimateScore =
    analysisTerritoryInfo.value.estimating &&
    !analysisTerritoryInfo.value.confirming;
  const result = showEstimateScore ? territory.result?.analysis : undefined;

  if (!showEstimateScore && analysisAiState.value.enabled) {
    return null;
  }

  if (showEstimateScore && territory.pending) {
    return null;
  }
  if (!result) {
    return null;
  }

  const winrate = `${Math.round(result.winrate * 1000) / 10}%`;
  const score = formatAiScore(result.scoreMean);

  return (
    <span>
      {score ? `${score} · ` : ""}
      {winrate}
    </span>
  );
}

function formatAiScore(scoreMean: number | undefined): string | undefined {
  if (scoreMean == null || !Number.isFinite(scoreMean)) {
    return undefined;
  }

  return `${scoreMean >= 0 ? "W" : "B"}+${Math.abs(scoreMean).toFixed(1)}`;
}

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
      cols={size}
      rows={size}
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
            <AnalysisAiStatus />
          </GameStatus>
        ) : undefined
      }
      sidebarLeft={<AnalysisMoveTree moveTreeEl={moveTreeEl} />}
      sidebarRight={<AnalysisSettingsPanel {...props} />}
      sidebarRightTabId="settings"
      activeTab={analysisTab}
      tabBar={<AnalysisTabBar />}
    />
  );
}
