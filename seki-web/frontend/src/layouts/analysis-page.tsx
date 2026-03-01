import type { ControlsProps } from "../components/controls";
import type { PlayerPanelProps } from "../components/player-panel";
import { GameStatus, getStatusText } from "../components/game-status";
import { GameStage } from "../game/types";
import {
  blackSymbol,
  whiteSymbol,
  formatSize,
  formatSgfTime,
  formatTime,
} from "../utils/format";
import {
  buildNavProps,
  buildCoordsToggle,
  buildMoveConfirmToggle,
} from "../utils/shared-controls";
import type { CoordsToggleState } from "../utils/shared-controls";
import type { PremoveState } from "../utils/premove";
import { formatScoreStr } from "../game/ui";
import { playStoneSound } from "../game/sound";
import type { SgfMeta } from "../utils/sgf";
import { GamePageLayout } from "./game-page-layout";
import {
  analysisBoard,
  analysisMeta,
  analysisSize,
  analysisTerritoryInfo,
} from "./analysis-state";

const KOMI = 6.5;

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
  return (
    <>
      <h2>Analysis Board</h2>
      {meta && <p>{formatSgfDescription(meta)}</p>}
    </>
  );
}

function buildAnalysisPlayerPanel({ position }: { position: "top" | "bottom" }) {
  const board = analysisBoard.value;
  const meta = analysisMeta.value;

  if (!board) {
    return undefined;
  }

  const engine = board.engine;
  const { reviewing, finalized, score } = analysisTerritoryInfo.value;
  const isBlackTurn = engine.current_turn_stone() === 1;

  const { bStr, wStr } = formatScoreStr(
    KOMI,
    score,
    engine.captures_black(),
    engine.captures_white(),
  );

  const whiteName = meta?.white_name ?? "White";
  const blackName = meta?.black_name ?? "Black";

  // Per-move time (BL/WL) if available, else static time settings
  const mtJson = engine.current_move_time();
  let bClock = "";
  let wClock = "";
  if (mtJson) {
    const mt = JSON.parse(mtJson);
    if (mt.black_time != null) {
      bClock = formatTime(mt.black_time);
      if (mt.black_periods != null) {
        bClock += ` (${mt.black_periods})`;
      }
    }
    if (mt.white_time != null) {
      wClock = formatTime(mt.white_time);
      if (mt.white_periods != null) {
        wClock += ` (${mt.white_periods})`;
      }
    }
  }
  if (!bClock && !wClock) {
    const fallback =
      formatSgfTime(meta?.time_limit_secs, meta?.overtime) ?? "";
    bClock = fallback;
    wClock = fallback;
  }

  const whitePanel: PlayerPanelProps = {
    name: whiteName,
    captures: wStr,
    stone: "white",
    clock: wClock,
  };
  const blackPanel: PlayerPanelProps = {
    name: blackName,
    captures: bStr,
    stone: "black",
    clock: bClock,
  };

  // White on top, black on bottom
  return position === "top" ? whitePanel : blackPanel;
}

function buildAnalysisControls({
  pm,
  coordsState,
  onSizeChange,
  handleSgfImport,
  handleSgfExport,
}: {
  pm: PremoveState;
  coordsState: CoordsToggleState;
  onSizeChange: (size: number) => void;
  handleSgfImport: (input: HTMLInputElement) => void;
  handleSgfExport: () => void;
}) {
  const board = analysisBoard.value;
  const reviewing = board?.isTerritoryReview() ?? false;
  const finalized = board?.isFinalized() ?? false;

  const props: ControlsProps = {
    layout: "analysis",
    nav: buildNavProps(board),
    coordsToggle: buildCoordsToggle(board, coordsState),
    moveConfirmToggle: buildMoveConfirmToggle(pm, board),
    sizeSelect: {
      value: analysisSize.value,
      options: [9, 13, 19],
      onChange: onSizeChange,
    },
  };

  if (reviewing) {
    props.territoryReady = {
      onClick: () => board?.finalizeTerritoryReview(),
    };
    props.territoryExit = {
      onClick: () => board?.exitTerritoryReview(),
    };
  } else if (!finalized) {
    props.pass = { onClick: () => board?.pass() };
    props.estimate = { onClick: () => board?.enterTerritoryReview() };
    props.sgfImport = { onFileChange: handleSgfImport };
    props.sgfExport = { onClick: handleSgfExport };
    props.territoryReady = undefined;
    props.territoryExit = undefined;
  }

  if (pm.value) {
    props.confirmMove = {
      onClick: () => {
        if (pm.value && board) {
          const [col, row] = pm.value;
          pm.clear();
          if (board.engine.try_play(col, row)) {
            playStoneSound();
            board.save();
            board.render();
          }
        }
      },
    };
  }

  return props;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export type AnalysisPageProps = {
  gobanRef: preact.Ref<HTMLDivElement>;
  pm: PremoveState;
  coordsState: CoordsToggleState;
  moveTreeEl: HTMLElement;
  onSizeChange: (size: number) => void;
  handleSgfImport: (input: HTMLInputElement) => void;
  handleSgfExport: () => void;
};

export function AnalysisPage(props: AnalysisPageProps) {
  const {
    gobanRef,
    pm,
    coordsState,
    moveTreeEl,
    onSizeChange,
    handleSgfImport,
    handleSgfExport,
  } = props;

  const size = analysisSize.value;

  const controlsProps = buildAnalysisControls({
    pm,
    coordsState,
    onSizeChange,
    handleSgfImport,
    handleSgfExport,
  });

  const board = analysisBoard.value;
  const { reviewing, finalized, score } = analysisTerritoryInfo.value;
  const isBlackTurn = board ? board.engine.current_turn_stone() === 1 : true;

  const statusText = getStatusText({
    stage: reviewing
      ? GameStage.TerritoryReview
      : isBlackTurn
        ? GameStage.BlackToPlay
        : GameStage.WhiteToPlay,
    komi: KOMI,
    territoryScore: (reviewing || finalized) ? score : undefined,
    isBlackTurn,
  });

  return (
    <GamePageLayout
      header={<AnalysisHeader />}
      gobanRef={gobanRef}
      gobanStyle={`aspect-ratio: ${size}/${size}`}
      playerTop={buildAnalysisPlayerPanel({ position: "top" })}
      playerBottom={buildAnalysisPlayerPanel({ position: "bottom" })}
      controls={controlsProps}
      status={statusText ? <GameStatus text={statusText} /> : undefined}
      moveTree={
        <div
          class="move-tree-slot"
          ref={(el) => {
            if (el && !el.contains(moveTreeEl)) {
              el.appendChild(moveTreeEl);
            }
          }}
        />
      }
    />
  );
}
