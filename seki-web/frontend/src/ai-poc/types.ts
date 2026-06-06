import type { AiPocPosition } from "./feature-encoder";

export type AiPocBackend = "webgpu" | "wasm" | "cpu";

export type AiPocBackendPreference = "auto" | "webgpu" | "wasm";

export type AiPocRuntime = "tfjs" | "onnxruntime-web";

export type AiPocManifest = {
  id: string;
  version: number;
  kind: "tfjs-graph-model" | "onnx" | "synthetic";
  source: {
    name: string;
    url?: string;
    sha256?: string;
  };
  artifacts?: {
    model: string;
    weights?: string[];
  };
  boardSizes: number[];
  outputs: string[];
  outputMap?: Record<string, string>;
};

export type AiPocRunRequest = {
  id: string;
  type: "run";
  manifestUrl: string;
  boardSize: number;
  positionPreset: string;
  nextPlayer: "black" | "white";
  komi: number;
  backendPreference: AiPocBackendPreference;
  policyOptimism: number;
  runs: number;
};

export type AiPocSearchRequest = Omit<AiPocRunRequest, "type" | "runs"> & {
  type: "search";
  visits: number;
  maxChildren: number;
};

export type AiPocDirectPolicyRequest = Omit<
  AiPocRunRequest,
  "type" | "runs"
> & {
  type: "direct-policy";
  maxPolicyActions: number;
  position?: AiPocPosition;
};

export type AiPocRandomMctsRequest = Omit<AiPocRunRequest, "type" | "runs"> & {
  type: "random-mcts";
  visits: number;
  rolloutLimit: number;
  maxPolicyActions: number;
  fpuReduction: number;
  seed: number;
};

export type AiPocRustPolicyMctsRequest = Omit<
  AiPocRunRequest,
  "type" | "runs"
> & {
  type: "rust-policy-mcts";
  visits: number;
  rolloutLimit: number;
  maxPolicyActions: number;
  fpuReduction: number;
  seed: number;
};

export type AiPocRustLeafPolicyMctsRequest = Omit<
  AiPocRunRequest,
  "type" | "runs"
> & {
  type: "rust-leaf-policy-mcts";
  visits: number;
  maxPolicyActions: number;
  batchSize: number;
  fpuReduction: number;
  position?: AiPocPosition;
};

export type AiAnalysisPresetId = "direct" | "mobile-fast" | "tuning";

export type AiAnalyzePositionRequest = {
  id: string;
  type: "analyze-position";
  manifestUrl: string;
  backendPreference: AiPocBackendPreference;
  policyOptimism: number;
  position: AiPocPosition;
  preset: AiAnalysisPresetId;
};

export type AiPocRequest =
  | AiPocRunRequest
  | AiPocSearchRequest
  | AiPocDirectPolicyRequest
  | AiPocRandomMctsRequest
  | AiPocRustPolicyMctsRequest
  | AiPocRustLeafPolicyMctsRequest
  | AiAnalyzePositionRequest;

export type AiPocMetricSummary = {
  p50Ms: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
};

export type AiPocWebGpuStatus = {
  available: boolean;
  reason?: string;
};

export type AiPocRandomMctsDiagnostics = {
  catchUpVisits: number;
  cycleVisits: number;
  terminalVisits: number;
  invalidActionVisits: number;
  rootVisitEntropy: number;
  visitedRootMoves: number;
  visitedRootPolicyMass: number;
};

export type AiPocInterpretation = {
  value?: {
    win: number;
    loss: number;
    noResult: number;
  };
  topPolicyMoves?: Array<{
    move: string;
    probability: number;
    logit: number;
  }>;
  ownership?: {
    min: number;
    max: number;
    mean: number;
  };
};

export type AiPocResult = {
  manifest: AiPocManifest;
  runtime: AiPocRuntime;
  backend: AiPocBackend;
  backendPreference: AiPocBackendPreference;
  fallbackReason?: string;
  model?: {
    artifactBytes?: number;
    inputNames?: string[];
    outputNames?: string[];
    rawOutputCount?: number;
  };
  webgpu?: AiPocWebGpuStatus;
  input?: {
    encoding: string;
    boardSize: number;
    nextPlayer: string;
    komi: number;
    nonZeroBinaryFeatures: number;
    nonZeroGlobalFeatures: number;
    omittedFeatures: string[];
  };
  timings: {
    workerStartedAt: number;
    manifestMs: number;
    backendMs: number;
    modelLoadMs: number;
    warmupMs: number;
    eval: AiPocMetricSummary;
  };
  outputs: Array<{
    name: string;
    rawName?: string;
    shape: number[];
    dtype: string;
    sample: Array<number | string>;
  }>;
  interpretation?: AiPocInterpretation;
  environment: {
    userAgent: string;
    crossOriginIsolated: boolean;
    hardwareConcurrency?: number;
  };
};

export type AiPocSearchMove = {
  move: string;
  visits: number;
  prior: number;
  value: number;
};

export type AiPocSearchResult = {
  manifest: AiPocManifest;
  runtime: AiPocRuntime;
  backend: AiPocBackend;
  backendPreference: AiPocBackendPreference;
  fallbackReason?: string;
  model?: AiPocResult["model"];
  webgpu?: AiPocWebGpuStatus;
  input?: AiPocResult["input"];
  search: {
    visits: number;
    maxChildren: number;
    elapsedMs: number;
    bestMove?: string;
    rootValue: number;
    topMoves: AiPocSearchMove[];
  };
  environment: AiPocResult["environment"];
};

export type AiPocDirectPolicyResult = {
  runtime: "go-engine-wasm";
  policyRuntime: AiPocRuntime;
  manifest: AiPocManifest;
  backend: AiPocBackend;
  backendPreference: AiPocBackendPreference;
  fallbackReason?: string;
  model?: AiPocResult["model"];
  webgpu?: AiPocWebGpuStatus;
  input: {
    boardSize: number;
    positionPreset: string;
    nextPlayer: string;
    komi: number;
    policyOptimism: number;
  };
  directPolicy: {
    maxPolicyActions: number;
    policyOptimism: number;
    modelLoadMs: number;
    modelEvalMs: number;
    totalElapsedMs: number;
    bestMove?: string;
    winrate: number;
    rootValue: number;
    policySource: string;
    valueSource: string;
    legalMoves: AiPocRandomMctsEdge[];
  };
  environment: AiPocResult["environment"];
};

export type AiPocRandomMctsMove =
  | {
      kind: "play";
      col: number;
      row: number;
    }
  | { kind: "pass" };

export type AiPocRandomMctsEdge = {
  action: AiPocRandomMctsMove;
  move?: string;
  visits: number;
  prior: number;
  value: number;
};

export type AiPocRandomMctsResult = {
  runtime: "go-engine-wasm";
  policyRuntime?: AiPocRuntime;
  manifest?: AiPocManifest;
  backend?: AiPocBackend;
  backendPreference?: AiPocBackendPreference;
  fallbackReason?: string;
  model?: AiPocResult["model"];
  webgpu?: AiPocWebGpuStatus;
  input: {
    boardSize: number;
    positionPreset: string;
    nextPlayer: string;
    komi: number;
    policyOptimism?: number;
  };
  randomSearch: {
    visits: number;
    rolloutLimit: number;
    maxPolicyActions: number;
    fpuReduction?: number;
    policyOptimism?: number;
    seed: number;
    elapsedMs: number;
    modelLoadMs?: number;
    rootInferenceMs?: number;
    wasmSearchMs: number;
    totalElapsedMs: number;
    modelEvaluations?: number;
    modelBatches?: number;
    modelEvalMs?: number;
    batchSize?: number;
    bestMove?: string;
    winrate: number;
    rootValue: number;
    policySource: string;
    valueSource: string;
    rootPolicyMoves?: AiPocRandomMctsEdge[];
    rootEdges: AiPocRandomMctsEdge[];
    principalVariation: AiPocRandomMctsMove[];
    principalVariationMoves?: string[];
    diagnostics?: AiPocRandomMctsDiagnostics;
  };
  environment: AiPocResult["environment"];
};

export type AiAnalyzePositionResult = {
  runtime: "go-engine-wasm";
  policyRuntime: AiPocRuntime;
  manifest: AiPocManifest;
  backend: AiPocBackend;
  backendPreference: AiPocBackendPreference;
  fallbackReason?: string;
  model?: AiPocResult["model"];
  webgpu?: AiPocWebGpuStatus;
  input: {
    boardSize: number;
    nextPlayer: string;
    komi: number;
    policyOptimism?: number;
  };
  analysis: {
    preset: AiAnalysisPresetId;
    visits: number;
    maxPolicyActions: number;
    batchSize: number;
    fpuReduction: number;
    policyOptimism: number;
    bestMove?: string;
    winrate: number;
    rootValue: number;
    principalVariation: AiPocRandomMctsMove[];
    principalVariationMoves?: string[];
    rootMoves: AiPocRandomMctsEdge[];
    diagnostics?: AiPocRandomMctsDiagnostics;
    timings: {
      modelLoadMs?: number;
      modelEvalMs?: number;
      modelEvaluations?: number;
      modelBatches?: number;
      wasmSearchMs: number;
      totalElapsedMs: number;
    };
  };
  environment: AiPocResult["environment"];
};

export type AiPocResponse =
  | {
      id: string;
      type: "result";
      result:
        | AiPocResult
        | AiPocSearchResult
        | AiPocDirectPolicyResult
        | AiPocRandomMctsResult
        | AiAnalyzePositionResult;
    }
  | { id: string; type: "error"; message: string; stack?: string };
