import type { AiPocMove, AiPocPosition } from "./feature-encoder";
import type { AiPocSearchMove } from "./types";

export type AiPocPolicyEvaluation = {
  policy: Float32Array;
  value: number;
};

export type AiPocSearchOptions = {
  visits: number;
  maxChildren: number;
  cpuct?: number;
};

export type AiPocSearchSummary = {
  visits: number;
  maxChildren: number;
  elapsedMs: number;
  bestMove?: string;
  rootValue: number;
  topMoves: AiPocSearchMove[];
};

type SearchNode = {
  position: AiPocPosition;
  prior: number;
  move?: AiPocMove;
  visits: number;
  valueSum: number;
  children: SearchNode[];
  expanded: boolean;
};

export async function runPolicyMcts(
  rootPosition: AiPocPosition,
  options: AiPocSearchOptions,
  evaluate: (position: AiPocPosition) => Promise<AiPocPolicyEvaluation>,
): Promise<AiPocSearchSummary> {
  const startedAt = performance.now();
  const root: SearchNode = {
    position: rootPosition,
    prior: 1,
    visits: 0,
    valueSum: 0,
    children: [],
    expanded: false,
  };
  const visits = Math.max(1, Math.floor(options.visits));
  const maxChildren = Math.max(1, Math.floor(options.maxChildren));
  const cpuct = options.cpuct ?? 1.5;

  for (let i = 0; i < visits; i++) {
    const path = [root];
    let node = root;

    while (node.expanded && node.children.length > 0) {
      node = selectChild(node, cpuct);
      path.push(node);
    }

    const evaluation = await evaluate(node.position);
    if (!node.expanded) {
      expandNode(node, evaluation.policy, maxChildren);
    }
    backup(path, evaluation.value);
  }

  const topMoves = root.children
    .map((child) => ({
      move: formatMove(child.move, rootPosition.boardSize),
      visits: child.visits,
      prior: child.prior,
      value: meanValue(child),
    }))
    .sort((a, b) => b.visits - a.visits || b.prior - a.prior)
    .slice(0, 12);

  return {
    visits,
    maxChildren,
    elapsedMs: performance.now() - startedAt,
    bestMove: topMoves[0]?.move,
    rootValue: meanValue(root),
    topMoves,
  };
}

function selectChild(node: SearchNode, cpuct: number): SearchNode {
  let best = node.children[0]!;
  let bestScore = -Infinity;
  const parentVisits = Math.max(1, node.visits);

  for (const child of node.children) {
    const q = -meanValue(child);
    const u =
      (cpuct * child.prior * Math.sqrt(parentVisits)) / (1 + child.visits);
    const score = q + u;

    if (score > bestScore) {
      best = child;
      bestScore = score;
    }
  }

  return best;
}

function expandNode(
  node: SearchNode,
  policy: Float32Array,
  maxChildren: number,
) {
  const legalMoves = legalMovesFor(node.position);
  const scored = legalMoves
    .map((move) => ({
      move,
      logit: policy[policyIndex(move, node.position.boardSize)] ?? 0,
    }))
    .sort((a, b) => b.logit - a.logit)
    .slice(0, maxChildren);
  const priors = softmax(scored.map((entry) => entry.logit));

  node.children = scored.map((entry, index) => ({
    position: applyMove(node.position, entry.move),
    prior: priors[index] ?? 0,
    move: entry.move,
    visits: 0,
    valueSum: 0,
    children: [],
    expanded: false,
  }));
  node.expanded = true;
}

function backup(path: SearchNode[], leafValue: number) {
  let value = leafValue;

  for (let i = path.length - 1; i >= 0; i--) {
    const node = path[i]!;
    node.visits += 1;
    node.valueSum += value;
    value = -value;
  }
}

function legalMovesFor(position: AiPocPosition): AiPocMove[] {
  const occupied = new Set(
    position.stones.map((stone) =>
      pointIndex(stone.col, stone.row, position.boardSize),
    ),
  );
  const moves: AiPocMove[] = [];

  for (let row = 0; row < position.boardSize; row++) {
    for (let col = 0; col < position.boardSize; col++) {
      if (!occupied.has(pointIndex(col, row, position.boardSize))) {
        moves.push({ kind: "play", col, row, player: position.nextPlayer });
      }
    }
  }

  moves.push({ kind: "pass", player: position.nextPlayer });

  return moves;
}

function applyMove(position: AiPocPosition, move: AiPocMove): AiPocPosition {
  const nextPlayer = position.nextPlayer === "black" ? "white" : "black";

  return {
    ...position,
    nextPlayer,
    stones:
      move.kind === "play"
        ? [
            ...position.stones,
            { col: move.col, row: move.row, player: move.player },
          ]
        : position.stones,
    recentMoves: [move, ...position.recentMoves].slice(0, 5),
  };
}

function policyIndex(move: AiPocMove, boardSize: number): number {
  if (move.kind === "pass") {
    return boardSize * boardSize;
  }

  return pointIndex(move.col, move.row, boardSize);
}

function pointIndex(col: number, row: number, boardSize: number): number {
  return row * boardSize + col;
}

function meanValue(node: SearchNode): number {
  return node.visits > 0 ? node.valueSum / node.visits : 0;
}

function formatMove(move: AiPocMove | undefined, boardSize: number): string {
  if (!move || move.kind === "pass") {
    return "pass";
  }

  return `${gtpColumn(move.col)}${boardSize - move.row}`;
}

function gtpColumn(col: number): string {
  const code = "A".charCodeAt(0) + col + (col >= 8 ? 1 : 0);

  return String.fromCharCode(code);
}

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((value) => Math.exp(value - max));
  const sum = exps.reduce((total, value) => total + value, 0);

  return exps.map((value) => value / sum);
}
