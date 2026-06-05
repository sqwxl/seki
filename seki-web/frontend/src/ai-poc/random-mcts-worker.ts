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
  AiPocRustLeafPolicyMctsRequest,
  AiPocRustPolicyMctsRequest,
  AiPocWebGpuStatus,
} from "./types";

type EngineWasmModule = typeof import("/static/wasm/go_engine_wasm.js");
type EngineWasm = InstanceType<EngineWasmModule["WasmEngine"]>;
type PolicyMctsSearch = {
  next_batch_json(batchSize: number): string;
  apply_batch_json(evaluationsJson: string): string;
  summary_json(): string;
};
type RustMctsRequest = AiPocRandomMctsRequest | AiPocRustPolicyMctsRequest;
type RustMctsOptions = {
  rootPolicyLogits?: Float32Array;
  rootValue?: number;
  totalStartedAt?: number;
  modelLoadMs?: number;
  rootInferenceMs?: number;
  manifest?: AiPocManifest;
  policyRuntime?: AiPocRuntime;
  backend?: AiPocBackend;
  backendPreference?: AiPocBackendPreference;
  fallbackReason?: string;
  model?: AiPocResult["model"];
  webgpu?: AiPocWebGpuStatus;
};
type LeafPolicyMctsOptions = Omit<
  RustMctsOptions,
  "rootPolicyLogits" | "rootValue"
> & {
  evaluateBatch: (positions: AiPocPosition[]) => Promise<{
    evaluations: Array<{
      policy: Float32Array;
      value: number;
    }>;
    elapsedMs: number;
  }>;
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

type PolicyMctsBatchResponse = {
  error?: string | null;
  requests: Array<{
    id: number;
    position: AiPocPosition;
  }>;
  completedVisits: number;
  pending: number;
  complete: boolean;
};

type PolicyMctsSummaryResponse = {
  error?: string | null;
  bestMove?: AiPocRandomMctsMove | null;
  visits: number;
  winrate: number;
  rootValue: number;
  rootEdges: AiPocRandomMctsEdge[];
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
  const engine = new wasm.WasmEngine(position.boardSize, position.boardSize);

  applyAiPocPosition(engine, position);

  const startedAt = performance.now();
  const raw = engine.random_mcts_json(
    JSON.stringify({
      visits: request.visits,
      rolloutLimit: request.rolloutLimit,
      maxPolicyActions: request.maxPolicyActions,
      seed: request.seed,
      komi: position.komi,
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

  const wasmSearchMs = performance.now() - startedAt;

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
      boardSize: position.boardSize,
      positionPreset: request.positionPreset,
      nextPlayer: position.nextPlayer,
      komi: position.komi,
    },
    randomSearch: {
      visits: response.visits,
      rolloutLimit: request.rolloutLimit,
      maxPolicyActions: response.maxPolicyActions ?? request.maxPolicyActions,
      seed: request.seed,
      elapsedMs: wasmSearchMs,
      modelLoadMs: options.modelLoadMs,
      rootInferenceMs: options.rootInferenceMs,
      wasmSearchMs,
      totalElapsedMs: performance.now() - (options.totalStartedAt ?? startedAt),
      bestMove: formatRandomMctsMove(response.bestMove, position.boardSize),
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

export async function runLeafPolicyMcts(
  request: AiPocRustLeafPolicyMctsRequest,
  options: LeafPolicyMctsOptions,
): Promise<AiPocRandomMctsResult> {
  const wasm = await ensureEngineWasm();
  const position = createAiPocPosition(
    request.positionPreset,
    request.boardSize,
    request.nextPlayer,
    request.komi,
  );
  const engine = new wasm.WasmEngine(position.boardSize, position.boardSize);

  applyAiPocPosition(engine, position);

  const search = (
    engine as EngineWasm & {
      policy_mcts_json(requestJson: string): PolicyMctsSearch;
    }
  ).policy_mcts_json(
    JSON.stringify({
      visits: request.visits,
      maxPolicyActions: request.maxPolicyActions,
      komi: position.komi,
    }),
  );
  const wasmStartedAt = performance.now();
  let wasmSearchMs = 0;
  let modelEvalMs = 0;
  let modelEvaluations = 0;
  let modelBatches = 0;

  while (true) {
    const nextBatchStartedAt = performance.now();
    const batchJson = search.next_batch_json(request.batchSize);
    wasmSearchMs += performance.now() - nextBatchStartedAt;
    const batch = JSON.parse(batchJson) as PolicyMctsBatchResponse;

    if (batch.error) {
      throw new Error(batch.error);
    }

    if (batch.requests.length === 0) {
      if (batch.complete) {
        break;
      }

      throw new Error("policy MCTS search stalled without eval requests");
    }

    const batchEvaluation = await options.evaluateBatch(
      batch.requests.map((request) => request.position),
    );

    if (batchEvaluation.evaluations.length !== batch.requests.length) {
      throw new Error("policy MCTS batch eval returned the wrong result count");
    }

    modelEvalMs += batchEvaluation.elapsedMs;
    modelEvaluations += batchEvaluation.evaluations.length;
    modelBatches += 1;

    const evaluations = batch.requests.map((evalRequest, index) => {
      const evaluation = batchEvaluation.evaluations[index]!;

      return {
        id: evalRequest.id,
        policyLogits: Array.from(evaluation.policy),
        value: evaluation.value,
      };
    });

    const applyStartedAt = performance.now();
    const statusJson = search.apply_batch_json(JSON.stringify({ evaluations }));
    wasmSearchMs += performance.now() - applyStartedAt;
    const status = JSON.parse(statusJson) as { error?: string | null };

    if (status.error) {
      throw new Error(status.error);
    }
  }

  const summaryStartedAt = performance.now();
  const summaryJson = search.summary_json();
  wasmSearchMs += performance.now() - summaryStartedAt;
  const summary = JSON.parse(summaryJson) as PolicyMctsSummaryResponse;

  if (summary.error) {
    throw new Error(summary.error);
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
      boardSize: position.boardSize,
      positionPreset: request.positionPreset,
      nextPlayer: position.nextPlayer,
      komi: position.komi,
    },
    randomSearch: {
      visits: summary.visits,
      rolloutLimit: 0,
      maxPolicyActions: request.maxPolicyActions,
      seed: 0,
      elapsedMs: wasmSearchMs,
      modelLoadMs: options.modelLoadMs,
      wasmSearchMs,
      totalElapsedMs:
        performance.now() - (options.totalStartedAt ?? wasmStartedAt),
      modelEvaluations,
      modelBatches,
      modelEvalMs,
      batchSize: request.batchSize,
      bestMove: formatRandomMctsMove(summary.bestMove, position.boardSize),
      winrate: summary.winrate,
      rootValue: summary.rootValue,
      policySource: "external-leaf",
      valueSource: "external-leaf",
      rootEdges: summary.rootEdges,
      principalVariation: summary.bestMove ? [summary.bestMove] : [],
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
