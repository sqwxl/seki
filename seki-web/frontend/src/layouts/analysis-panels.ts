import { buildPlayerPanels } from "../game/capabilities";
import type { Board, TerritoryInfo } from "../goban/create-board";
import { formatSgfTime, formatTime } from "../utils/format";
import type { SgfMeta } from "../utils/sgf";
import type { AnalysisPanelData } from "./analysis-state";

export function buildAnalysisPanels({
  board,
  meta,
  komi,
  territoryInfo,
}: {
  board: Board;
  meta: SgfMeta | undefined;
  komi: number;
  territoryInfo: TerritoryInfo;
}): {
  top: AnalysisPanelData;
  bottom: AnalysisPanelData;
} {
  const engine = board.engine;
  const { score } = territoryInfo;
  const whiteName = meta?.white_name ?? "White";
  const blackName = meta?.black_name ?? "Black";

  const mtJson = engine.current_move_time();
  let bClock = "";
  let wClock = "";

  if (mtJson) {
    const mt = JSON.parse(mtJson) as {
      black_time?: number;
      black_periods?: number;
      white_time?: number;
      white_periods?: number;
    };

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
    komi,
    captures: {
      black: engine.captures_black(),
      white: engine.captures_white(),
    },
    score,
  });

  return {
    top: {
      ...panels.white,
      label: whiteName,
      stone: "white",
      clock: wClock,
    },
    bottom: {
      ...panels.black,
      label: blackName,
      stone: "black",
      clock: bClock,
    },
  };
}
