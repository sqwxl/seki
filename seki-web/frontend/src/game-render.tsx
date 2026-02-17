import { render } from "preact";
import { Goban } from "./goban/index";
import { GameStage, type MarkerData, type Point } from "./goban/types";
import type { GameCtx } from "./game-context";
import type { GameChannel } from "./game-channel";

const koMarker: MarkerData = { type: "triangle", label: "ko" };

export function renderGoban(
  ctx: GameCtx,
  gobanEl: HTMLElement,
  channel: GameChannel,
): void {
  if (ctx.gameState.board.length === 0) {
    return;
  }

  const { board: boardData, cols, rows, ko } = ctx.gameState;

  const isTerritoryReview =
    ctx.gameStage === GameStage.TerritoryReview && ctx.territory != null;

  const onVertexClick = isLiveClickable(ctx)
    ? (_: Event, position: Point) => {
        if (isTerritoryReview) {
          channel.toggleChain(position[0], position[1]);
        } else {
          channel.play(position[0], position[1]);
        }
      }
    : undefined;

  const markerMap: (MarkerData | null)[] = Array(boardData.length).fill(null);

  if (!isTerritoryReview) {
    if (ctx.moves.length > 0) {
      const lastMove = ctx.moves[ctx.moves.length - 1];
      if (lastMove.kind === "play" && lastMove.pos) {
        const [col, row] = lastMove.pos;
        markerMap[row * cols + col] = { type: "circle" };
      }
    }

    if (ko != null) {
      markerMap[ko.pos[1] * cols + ko.pos[0]] = koMarker;
    }
  }

  let paintMap: (number | null)[] | undefined;
  let dimmedVertices: Point[] | undefined;

  if (isTerritoryReview) {
    paintMap = ctx.territory!.ownership.map((v) => (v === 0 ? null : v));
    dimmedVertices = ctx.territory!.dead_stones.map(
      ([c, r]) => [c, r] as Point,
    );
  }

  const avail = gobanEl.clientWidth;
  const extra = 0.8;
  const vertexSize = Math.max(avail / (Math.max(cols, rows) + extra), 12);

  render(
    <Goban
      cols={cols}
      rows={rows}
      vertexSize={vertexSize}
      signMap={boardData}
      markerMap={markerMap}
      paintMap={paintMap}
      dimmedVertices={dimmedVertices}
      fuzzyStonePlacement
      animateStonePlacement
      onVertexClick={onVertexClick}
    />,
    gobanEl,
  );
}

function isLiveClickable(ctx: GameCtx): boolean {
  if (ctx.analysisMode) {
    return false;
  }
  if (!ctx.board || !ctx.board.engine.is_at_latest()) {
    return false;
  }
  if (ctx.playerStone === 0) {
    return false;
  }
  if (ctx.gameStage === GameStage.TerritoryReview) {
    return true;
  }
  return (
    (ctx.gameStage === GameStage.BlackToPlay ||
      ctx.gameStage === GameStage.WhiteToPlay) &&
    ctx.currentTurn === ctx.playerStone
  );
}
