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
  runs: number;
};

export type AiPocSearchRequest = Omit<AiPocRunRequest, "type" | "runs"> & {
  type: "search";
  visits: number;
  maxChildren: number;
};

export type AiPocRandomMctsRequest = Omit<AiPocRunRequest, "type" | "runs"> & {
  type: "random-mcts";
  visits: number;
  rolloutLimit: number;
  maxPolicyActions: number;
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
  seed: number;
};

export type AiPocRequest =
  | AiPocRunRequest
  | AiPocSearchRequest
  | AiPocRandomMctsRequest
  | AiPocRustPolicyMctsRequest;

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

export type AiPocRandomMctsMove =
  | {
      kind: "play";
      col: number;
      row: number;
    }
  | { kind: "pass" };

export type AiPocRandomMctsEdge = {
  action: AiPocRandomMctsMove;
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
  };
  randomSearch: {
    visits: number;
    rolloutLimit: number;
    maxPolicyActions: number;
    seed: number;
    elapsedMs: number;
    bestMove?: string;
    winrate: number;
    rootValue: number;
    policySource: string;
    valueSource: string;
    rootEdges: AiPocRandomMctsEdge[];
    principalVariation: AiPocRandomMctsMove[];
  };
  environment: AiPocResult["environment"];
};

export type AiPocResponse =
  | {
      id: string;
      type: "result";
      result: AiPocResult | AiPocSearchResult | AiPocRandomMctsResult;
    }
  | { id: string; type: "error"; message: string; stack?: string };
