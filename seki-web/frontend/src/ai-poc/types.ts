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

export type AiPocRequest = {
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

export type AiPocResponse =
  | { id: string; type: "result"; result: AiPocResult }
  | { id: string; type: "error"; message: string; stack?: string };
