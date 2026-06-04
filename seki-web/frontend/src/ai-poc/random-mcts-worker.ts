import {
  createAiPocPosition,
  type AiPocMove,
  type AiPocPlayer,
  type AiPocPosition,
} from "./feature-encoder";
import type {
  AiPocBackend,
  AiPocBackendPreference,
  AiPocManifest,
  AiPocRandomMctsEdge,
  AiPocRandomMctsMove,
  AiPocRandomMctsRequest,
  AiPocRandomMctsResult,
  AiPocResult,
  AiPocRuntime,
  AiPocRustPolicyMctsRequest,
  AiPocWebGpuStatus,
} from "./types";

type EngineWasmModule = typeof import("/static/wasm/go_engine_wasm.js");
type EngineWasm = InstanceType<EngineWasmModule["WasmEngine"]>;
type RustMctsRequest = AiPocRandomMctsRequest | AiPocRustPolicyMctsRequest;
type RustMctsOptions = {
  rootPolicyLogits?: Float32Array;
  rootValue?: number;
  manifest?: AiPocManifest;
  policyRuntime?: AiPocRuntime;
  backend?: AiPocBackend;
  backendPreference?: AiPocBackendPreference;
  fallbackReason?: string;
  model?: AiPocResult["model"];
  webgpu?: AiPocWebGpuStatus;
};

type RustRandomMctsResponse = {
  error?: string;
  bestMove?: AiPocRandomMctsMove | null;
  visits: number;
  winrate: number;
  rootValue: number;
  maxPolicyActions?: number;
  policySource?: string;
  valueSource?: string;
  rootEdges: AiPocRandomMctsEdge[];
  principalVariation: AiPocRandomMctsMove[];
};

let engineWasmModule: EngineWasmModule | undefined;

export async function runRandomMcts(
  request: RustMctsRequest,
  options: RustMctsOptions = {},
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
      maxPolicyActions: request.maxPolicyActions,
      seed: request.seed,
      komi: request.komi,
      rootPolicyLogits: options.rootPolicyLogits
        ? Array.from(options.rootPolicyLogits)
        : undefined,
      rootValue: options.rootValue,
    }),
  );
  const response = JSON.parse(raw) as RustRandomMctsResponse;

  if (response.error) {
    throw new Error(response.error);
  }

  return {
    runtime: "go-engine-wasm",
    policyRuntime: options.policyRuntime,
    manifest: options.manifest,
    backend: options.backend,
    backendPreference: options.backendPreference,
    fallbackReason: options.fallbackReason,
    model: options.model,
    webgpu: options.webgpu,
    input: {
      boardSize: request.boardSize,
      positionPreset: request.positionPreset,
      nextPlayer: request.nextPlayer,
      komi: request.komi,
    },
    randomSearch: {
      visits: response.visits,
      rolloutLimit: request.rolloutLimit,
      maxPolicyActions: response.maxPolicyActions ?? request.maxPolicyActions,
      seed: request.seed,
      elapsedMs: performance.now() - startedAt,
      bestMove: formatRandomMctsMove(response.bestMove, request.boardSize),
      winrate: response.winrate,
      rootValue: response.rootValue,
      policySource: response.policySource ?? "baseline-rollout",
      valueSource: response.valueSource ?? "rollout",
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
