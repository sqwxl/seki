import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { formatClock } from "../game/clock";
import type { GameSettings, UserData } from "../game/types";
import { GameStage } from "../game/types";
import { Goban } from "../goban";
import type { MarkerData } from "../goban/types";
import type { ClockSnapshot, LiveGameItem } from "./game-description";
import { UserLabel } from "./user-label";

type MiniGobanCellProps = {
  game: LiveGameItem;
};

export function MiniGobanCell({ game }: MiniGobanCellProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [vertexSize, setVertexSize] = useState(12);

  const cols = game.settings.cols;
  const rows = game.settings.rows;
  const boardState = game.board_state;
  const signMap =
    boardState?.board ?? Array.from<number>({ length: cols * rows }).fill(0);

  const markerMap: (MarkerData | null)[] | undefined = useMemo(() => {
    const lm = boardState?.last_move;
    const ko = boardState?.ko?.pos;
    if (!lm && !ko) return undefined;

    const map: (MarkerData | null)[] = Array(signMap.length).fill(null);

    if (lm) {
      const [lc, lr] = lm;
      map[lr * cols + lc] = { type: "circle" };
    }

    if (ko) {
      const [kc, kr] = ko;
      map[kr * cols + kc] = { type: "triangle", label: "ko" };
    }

    return map;
  }, [boardState?.last_move, boardState?.ko, cols, signMap.length]);

  // Territory paint overlay for completed games
  const paintMap = useMemo(() => {
    const o = boardState?.ownership;
    if (!o || o.length !== signMap.length) return undefined;
    return o;
  }, [boardState?.ownership, signMap.length]);

  useEffect(() => {
    const el = boardRef.current;
    if (!el) {
      return;
    }

    const compute = () => {
      const maxDim = Math.max(cols, rows);
      const size = Math.min(el.clientWidth, el.clientHeight);
      setVertexSize(Math.max(Math.floor(size / (maxDim + 0.8)), 6));
    };

    compute();

    const ro = new ResizeObserver(() => compute());
    ro.observe(el);

    return () => ro.disconnect();
  }, [cols, rows]);

  const dismissed = game.result === "Aborted" || game.result === "Declined";
  const isFinished =
    game.stage === GameStage.Completed && game.result && !dismissed;

  return (
    <a
      href={`/games/${game.id}`}
      class={`mini-goban-cell${dismissed ? " dismissed" : ""}`}
    >
      <MiniPanel
        user={game.white}
        stone="white"
        strong={game.stage === GameStage.WhiteToPlay}
        settings={game.settings}
        clock={game.clock}
        captures={boardState?.captures?.white}
        komi={(game.derived_komi ?? game.settings.handicap >= 2) ? 0.5 : 6.5}
      />
      <div
        ref={boardRef}
        class="mini-goban-board"
        style={{ aspectRatio: `${cols}/${rows}` }}
      >
        {boardState ? (
          <Goban
            cols={cols}
            rows={rows}
            vertexSize={vertexSize}
            signMap={signMap}
            markerMap={markerMap}
            paintMap={paintMap}
          />
        ) : (
          <div class="mini-goban-placeholder" />
        )}
        {isFinished && (
          <div class="mini-goban-result-overlay">{game.result}</div>
        )}
      </div>
      <MiniPanel
        user={game.black}
        stone="black"
        strong={game.stage === GameStage.BlackToPlay}
        settings={game.settings}
        clock={game.clock}
        captures={boardState?.captures?.black}
        komi={undefined}
      />
    </a>
  );
}

type MiniPanelProps = {
  user: UserData | undefined;
  stone: "black" | "white";
  strong: boolean;
  settings: GameSettings;
  clock?: ClockSnapshot;
  captures?: number;
  komi?: number;
};

function MiniPanel({
  user,
  stone,
  strong,
  settings,
  clock,
  captures,
  komi,
}: MiniPanelProps) {
  const isCorr = settings.time_control === "correspondence";
  const clockMs = stone === "black" ? clock?.black_ms : clock?.white_ms;
  const clockText = clockMs != null ? formatClock(clockMs, isCorr) : undefined;

  const points = (captures ?? 0) + (komi ?? 0);

  return (
    <div class={`mini-panel${strong ? " active-turn" : ""}`}>
      <span class="mini-panel-name">
        {user ? (
          <UserLabel user={user} noLink options={{ strong }} />
        ) : (
          <span class="user-label">...</span>
        )}
      </span>
      <span class="mini-panel-info">
        {points > 0 ? `${points} ` : ""}
        {clockText && <span class="mini-panel-clock">{clockText}</span>}
      </span>
    </div>
  );
}
