import {
  createAiPocPosition,
  type AiPocMove,
  type AiPocPlayer,
  type AiPocPosition,
} from "./feature-encoder";
import type {
  AiPocRandomMctsEdge,
  AiPocRandomMctsMove,
  AiPocRandomMctsResult,
  AiPocRequest,
} from "./types";

type EngineWasmModule = typeof import("/static/wasm/go_engine_wasm.js");
type EngineWasm = InstanceType<EngineWasmModule["WasmEngine"]>;

type RustRandomMctsResponse = {
  error?: string;
  bestMove?: AiPocRandomMctsMove | null;
  visits: number;
  winrate: number;
  rootValue: number;
  rootEdges: AiPocRandomMctsEdge[];
  principalVariation: AiPocRandomMctsMove[];
};

let engineWasmModule: EngineWasmModule | undefined;

export async function runRandomMcts(
  request: Extract<AiPocRequest, { type: "random-mcts" }>,
): Promise<AiPocRandomMctsResult> {
  const wasm = await ensureEngineWasm();
  const position = createAiPocPosition(
    request.positionPreset,
    request.boardSize,
    request.nextPlayer,
    request.komi,
  );
  const engine = new wasm.WasmEngine(request.boardSize, request.boardSize);

  applyAiPocPosition(engine, position);

  const startedAt = performance.now();
  const raw = engine.random_mcts_json(
    JSON.stringify({
      visits: request.visits,
      rolloutLimit: request.rolloutLimit,
      seed: request.seed,
      komi: request.komi,
    }),
  );
  const response = JSON.parse(raw) as RustRandomMctsResponse;

  if (response.error) {
    throw new Error(response.error);
  }

  return {
    runtime: "go-engine-wasm",
    input: {
      boardSize: request.boardSize,
      positionPreset: request.positionPreset,
      nextPlayer: request.nextPlayer,
      komi: request.komi,
    },
    randomSearch: {
      visits: response.visits,
      rolloutLimit: request.rolloutLimit,
      seed: request.seed,
      elapsedMs: performance.now() - startedAt,
      bestMove: formatRandomMctsMove(response.bestMove, request.boardSize),
      winrate: response.winrate,
      rootValue: response.rootValue,
      rootEdges: response.rootEdges,
      principalVariation: response.principalVariation,
    },
    environment: {
      userAgent: navigator.userAgent,
      crossOriginIsolated: self.crossOriginIsolated,
      hardwareConcurrency: navigator.hardwareConcurrency,
    },
  };
}

async function ensureEngineWasm(): Promise<EngineWasmModule> {
  if (engineWasmModule) {
    return engineWasmModule;
  }

  const wasm = await import("/static/wasm/go_engine_wasm.js");
  await wasm.default();
  engineWasmModule = wasm;

  return wasm;
}

function applyAiPocPosition(engine: EngineWasm, position: AiPocPosition) {
  for (const move of [...position.recentMoves].reverse()) {
    if (!applyAiPocMove(engine, move)) {
      throw new Error("PoC position cannot be replayed into go-engine WASM");
    }
  }

  if (currentWasmPlayer(engine) === position.nextPlayer) {
    return;
  }

  if (!engine.pass() || currentWasmPlayer(engine) !== position.nextPlayer) {
    throw new Error("PoC position cannot align requested side to move");
  }
}

function applyAiPocMove(engine: EngineWasm, move: AiPocMove): boolean {
  return move.kind === "pass"
    ? engine.pass()
    : engine.try_play(move.col, move.row);
}

function currentWasmPlayer(engine: EngineWasm): AiPocPlayer {
  return engine.current_turn_stone() === 1 ? "black" : "white";
}

function formatRandomMctsMove(
  move: AiPocRandomMctsMove | null | undefined,
  boardSize: number,
): string | undefined {
  if (!move) {
    return undefined;
  }

  if (move.kind === "pass") {
    return "pass";
  }

  return `${gtpColumn(move.col)}${boardSize - move.row}`;
}

function gtpColumn(col: number): string {
  const code = "A".charCodeAt(0) + col + (col >= 8 ? 1 : 0);

  return String.fromCharCode(code);
}
