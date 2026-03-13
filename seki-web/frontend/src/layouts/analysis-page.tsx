import type { ControlsProps } from "../components/controls";
import type { PlayerPanelProps } from "../components/player-panel";
import { GameStatus } from "../components/game-status";
import {
  blackSymbol,
  whiteSymbol,
  formatSize,
  formatSgfTime,
  formatTime,
} from "../utils/format";
import { buildNavProps } from "../utils/shared-controls";
import type { MoveConfirmState } from "../utils/move-confirm";
import { playStoneSound } from "../game/sound";
import type { SgfMeta } from "../utils/sgf";
import { GamePageLayout } from "./game-page-layout";
import type { AnalysisCapabilities } from "../game/capabilities";
import { analysisCapabilities, buildPlayerPanels } from "../game/capabilities";
import {
  analysisBoard,
  analysisKomi,
  analysisMeta,
  analysisSize,
  analysisTerritoryInfo,
} from "./analysis-state";

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

/**
 * Player panels read from WASM engine state (captures, move time) which
 * doesn't trigger signal updates — must be called during render.
 */
function buildAnalysisPlayerPanel({
  position,
}: {
  position: "top" | "bottom";
}) {
  const board = analysisBoard.value;
  const meta = analysisMeta.value;

  if (!board) {
    return undefined;
  }

  const engine = board.engine;
  const { score } = analysisTerritoryInfo.value;

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
    const fallback = formatSgfTime(meta?.time_limit_secs, meta?.overtime) ?? "";
    bClock = fallback;
    wClock = fallback;
  }

  const panels = buildPlayerPanels({
    komi: analysisKomi.value,
    captures: {
      black: engine.captures_black(),
      white: engine.captures_white(),
    },
    score,
  });

  const whitePanel: PlayerPanelProps = {
    ...panels.white,
    name: whiteName,
    stone: "white",
    clock: wClock,
  };
  const blackPanel: PlayerPanelProps = {
    ...panels.black,
    name: blackName,
    stone: "black",
    clock: bClock,
  };

  // White on top, black on bottom
  return position === "top" ? whitePanel : blackPanel;
}

// ---------------------------------------------------------------------------
// Controls builder — maps capabilities + callbacks to ControlsProps
// ---------------------------------------------------------------------------

function buildAnalysisControls(
  caps: AnalysisCapabilities,
  props: AnalysisPageProps,
): ControlsProps {
  const { mc, onSizeChange, onKomiChange, handleSgfImport, handleSgfExport } =
    props;
  const board = analysisBoard.value;

  const controlsProps: ControlsProps = {
    layout:
      caps.showTerritoryReady || caps.showTerritoryExit
        ? "analysis-review"
        : "analysis",
    nav: buildNavProps(board),
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
  if (mc.value) {
    controlsProps.confirmMove = {
      onClick: () => {
        if (mc.value && board) {
          const [col, row] = mc.value;
          mc.clear();
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

  const controlsProps = buildAnalysisControls(caps, props);

  const statusText = caps.statusText;

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
