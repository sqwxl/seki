import { render } from "preact";
import { Goban } from "./goban/index";
import {
  GameStage,
  isPlayStage,
  type GhostStoneData,
  type MarkerData,
  type Point,
  type Sign,
} from "./goban/types";
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
  const isMyTurn = ctx.currentTurn === ctx.playerStone;

  const onVertexClick = isLiveClickable(ctx)
    ? (_: Event, position: Point) => {
        if (isTerritoryReview) {
          channel.toggleChain(position[0], position[1]);
        } else if (isMyTurn) {
          ctx.premove = undefined;
          channel.play(position[0], position[1]);
        } else {
          const [col, row] = position;
          if (ctx.premove && ctx.premove[0] === col && ctx.premove[1] === row) {
            ctx.premove = undefined;
          } else {
            ctx.premove = position;
          }
          renderGoban(ctx, gobanEl, channel);
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

  let ghostStoneMap: (GhostStoneData | null)[] | undefined;
  if (ctx.premove) {
    const [pc, pr] = ctx.premove;
    ghostStoneMap = Array(boardData.length).fill(null);
    ghostStoneMap![pr * cols + pc] = { sign: ctx.playerStone as Sign };
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
      ghostStoneMap={ghostStoneMap}
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
  return isPlayStage(ctx.gameStage);
}
