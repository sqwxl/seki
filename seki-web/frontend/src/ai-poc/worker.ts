import "@tensorflow/tfjs-backend-wasm";
import { setWasmPaths } from "@tensorflow/tfjs-backend-wasm";
import "@tensorflow/tfjs-backend-webgpu";
import { loadGraphModel, type GraphModel } from "@tensorflow/tfjs-converter";
import * as tf from "@tensorflow/tfjs-core";
import * as ort from "onnxruntime-web/webgpu";
import {
  createAiPocPosition,
  encodeKataGoV7PocFeatures,
  type AiPocEncodedFeatures,
  type AiPocPosition,
} from "./feature-encoder";
import { runPolicyMcts } from "./mcts";
import { runLeafPolicyMcts, runRandomMcts } from "./random-mcts-worker";
import type {
  AiPocBackend,
  AiPocInterpretation,
  AiPocManifest,
  AiPocRandomMctsResult,
  AiPocRequest,
  AiPocResponse,
  AiPocResult,
  AiPocSearchResult,
  AiPocWebGpuStatus,
} from "./types";

const workerStartedAt = performance.now();

type BrowserGpu = {
  requestAdapter(options?: {
    powerPreference?: "low-power" | "high-performance";
  }): Promise<BrowserGpuAdapter | null>;
};

type BrowserGpuAdapter = {
  requestDevice(): Promise<unknown>;
};

function post(response: AiPocResponse) {
  self.postMessage(response);
}

async function fetchManifest(url: string): Promise<AiPocManifest> {
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Manifest fetch failed: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as AiPocManifest;
}

async function fetchContentLength(url: string): Promise<number | undefined> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    const length = res.headers.get("content-length");

    return length ? Number(length) : undefined;
  } catch {
    return undefined;
  }
}

async function chooseTfBackend(): Promise<{
  backend: AiPocBackend;
  fallbackReason?: string;
}> {
  const failures: string[] = [];

  for (const backend of ["webgpu", "wasm", "cpu"] as AiPocBackend[]) {
    if (backend === "webgpu" && !("gpu" in navigator)) {
      failures.push("webgpu: navigator.gpu is unavailable");

      continue;
    }

    try {
      await tf.setBackend(backend);
      await tf.ready();

      return {
        backend,
        fallbackReason: failures.length > 0 ? failures.join("; ") : undefined,
      };
    } catch (err) {
      failures.push(
        `${backend}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  throw new Error(
    `No TensorFlow.js backend initialized: ${failures.join("; ")}`,
  );
}

function makeTfInput(boardSize: number): tf.Tensor4D {
  const values = new Float32Array(boardSize * boardSize);
  const center = Math.floor(boardSize / 2);

  for (let row = 0; row < boardSize; row++) {
    for (let col = 0; col < boardSize; col++) {
      const distance = Math.abs(col - center) + Math.abs(row - center);

      values[row * boardSize + col] = 1 / (1 + distance);
    }
  }

  return tf.tensor4d(values, [1, boardSize, boardSize, 1]);
}

function syntheticPredict(input: tf.Tensor4D) {
  return tf.tidy(() => {
    const flat = tf.reshape(input, [input.size]);
    const policy = tf.softmax(flat);
    const value = tf.reshape(tf.mean(input), [1]);
    const ownership = tf.reshape(tf.sub(tf.mul(input, 2), 1), [input.size]);

    return {
      policy: tf.keep(policy),
      value: tf.keep(value),
      ownership: tf.keep(ownership),
    };
  });
}

async function loadTfModel(
  manifest: AiPocManifest,
): Promise<GraphModel | undefined> {
  if (manifest.kind === "synthetic") {
    return undefined;
  }

  if (!manifest.artifacts?.model) {
    throw new Error("TF.js graph manifest is missing artifacts.model");
  }

  return loadGraphModel(manifest.artifacts.model);
}

async function predictTf(
  manifest: AiPocManifest,
  model: GraphModel | undefined,
  input: tf.Tensor4D,
): Promise<Record<string, tf.Tensor>> {
  if (manifest.kind === "synthetic") {
    return syntheticPredict(input);
  }

  if (!model) {
    throw new Error("Model is not loaded");
  }

  const raw = model.predict(input);

  if (Array.isArray(raw)) {
    return Object.fromEntries(raw.map((tensor, i) => [`output_${i}`, tensor]));
  }

  return raw instanceof tf.Tensor ? { output: raw } : raw;
}

function makeOnnxShape(
  shape: ReadonlyArray<number | string>,
  boardSize: number,
): number[] {
  return shape.map((dim, index) => {
    if (typeof dim === "number" && dim > 0) {
      return dim;
    }

    const label = String(dim).toLowerCase();
    if (
      label.includes("board") ||
      label.includes("height") ||
      label.includes("width") ||
      label.includes("spatial")
    ) {
      return boardSize;
    }

    if (shape.length >= 3 && index >= shape.length - 2) {
      return boardSize;
    }

    return 1;
  });
}

function tensorSize(dims: readonly number[]): number {
  return dims.reduce((size, dim) => size * dim, 1);
}

function makeOnnxInputTensor(
  metadata: ort.InferenceSession.ValueMetadata,
  boardSize: number,
): ort.Tensor {
  if (!metadata.isTensor) {
    throw new Error(`Input ${metadata.name} is not a tensor`);
  }

  const dims = makeOnnxShape(metadata.shape, boardSize);
  const size = tensorSize(dims);

  switch (metadata.type) {
    case "float32":
      return new ort.Tensor("float32", new Float32Array(size).fill(1), dims);
    case "uint8":
      return new ort.Tensor("uint8", new Uint8Array(size).fill(1), dims);
    case "int8":
      return new ort.Tensor("int8", new Int8Array(size).fill(1), dims);
    case "uint16":
      return new ort.Tensor("uint16", new Uint16Array(size).fill(1), dims);
    case "int16":
      return new ort.Tensor("int16", new Int16Array(size).fill(1), dims);
    case "int32":
      return new ort.Tensor("int32", new Int32Array(size).fill(1), dims);
    case "int64":
      return new ort.Tensor("int64", new BigInt64Array(size).fill(1n), dims);
    case "string":
      return new ort.Tensor(
        "string",
        Array.from({ length: size }, () => ""),
        dims,
      );
    case "bool":
      return new ort.Tensor("bool", new Uint8Array(size).fill(1), dims);
    case "float16":
      return new ort.Tensor("float16", new Uint16Array(size).fill(1), dims);
    case "float64":
      return new ort.Tensor("float64", new Float64Array(size).fill(1), dims);
    case "uint32":
      return new ort.Tensor("uint32", new Uint32Array(size).fill(1), dims);
    case "uint64":
      return new ort.Tensor("uint64", new BigUint64Array(size).fill(1n), dims);
    case "uint4":
      return new ort.Tensor("uint4", new Uint8Array(size).fill(1), dims);
    case "int4":
      return new ort.Tensor("int4", new Int8Array(size).fill(1), dims);
  }
}

function makeOnnxFeeds(
  session: ort.InferenceSession,
  request: Extract<AiPocRequest, { type: "run" }>,
): {
  feeds: ort.InferenceSession.FeedsType;
  input?: AiPocEncodedFeatures["summary"];
} {
  if (
    session.inputNames.includes("bin_input") &&
    session.inputNames.includes("global_input")
  ) {
    const position = createAiPocPosition(
      request.positionPreset,
      request.boardSize,
      request.nextPlayer,
      request.komi,
    );
    const encoded = encodeKataGoV7PocFeatures(position);

    return {
      feeds: makeKayaOnnxFeeds(encoded),
      input: encoded.summary,
    };
  }

  if (
    session.inputNames.includes("InputMask") &&
    session.inputNames.includes("InputSpatial") &&
    session.inputNames.includes("InputGlobal")
  ) {
    const position = createAiPocPosition(
      request.positionPreset,
      request.boardSize,
      request.nextPlayer,
      request.komi,
    );
    const encoded = encodeKataGoV7PocFeatures(position);

    return {
      feeds: makeOfficialKataGoOnnxFeeds(encoded),
      input: encoded.summary,
    };
  }

  return {
    feeds: Object.fromEntries(
      session.inputMetadata.map((metadata) => [
        metadata.name,
        makeOnnxInputTensor(metadata, request.boardSize),
      ]),
    ),
  };
}

function makeOnnxFeedsForPosition(
  session: ort.InferenceSession,
  position: AiPocPosition,
): {
  feeds: ort.InferenceSession.FeedsType;
  input: AiPocEncodedFeatures["summary"];
} {
  const encoded = encodeKataGoV7PocFeatures(position);

  if (
    session.inputNames.includes("bin_input") &&
    session.inputNames.includes("global_input")
  ) {
    return {
      feeds: makeKayaOnnxFeeds(encoded),
      input: encoded.summary,
    };
  }

  if (
    session.inputNames.includes("InputMask") &&
    session.inputNames.includes("InputSpatial") &&
    session.inputNames.includes("InputGlobal")
  ) {
    return {
      feeds: makeOfficialKataGoOnnxFeeds(encoded),
      input: encoded.summary,
    };
  }

  throw new Error("Model inputs do not match a supported KataGo ONNX layout");
}

function makeKayaOnnxFeeds(
  encoded: AiPocEncodedFeatures,
): ort.InferenceSession.FeedsType {
  return {
    bin_input: new ort.Tensor("float32", encoded.binInput, encoded.binShape),
    global_input: new ort.Tensor(
      "float32",
      encoded.globalInput,
      encoded.globalShape,
    ),
  };
}

function makeOfficialKataGoOnnxFeeds(
  encoded: AiPocEncodedFeatures,
): ort.InferenceSession.FeedsType {
  const boardSize = encoded.summary.boardSize;

  return {
    InputMask: new ort.Tensor(
      "float32",
      new Float32Array(boardSize * boardSize).fill(1),
      [1, 1, boardSize, boardSize],
    ),
    InputSpatial: new ort.Tensor("float32", encoded.binInput, encoded.binShape),
    InputGlobal: new ort.Tensor("float32", encoded.globalInput, [
      1,
      encoded.globalInput.length,
      1,
      1,
    ]),
  };
}

function isOrtTensor(value: ort.OnnxValue): value is ort.Tensor {
  return (
    typeof value === "object" &&
    value !== null &&
    "dims" in value &&
    "type" in value &&
    "getData" in value
  );
}

function sampleOrtData(
  data: ort.Tensor.DataTypeMap[ort.Tensor.Type],
): Array<number | string> {
  if (Array.isArray(data)) {
    return data.slice(0, 8);
  }

  const sample: Array<number | string> = [];
  const count = Math.min(8, data.length);

  for (let i = 0; i < count; i++) {
    const item = data[i];

    if (typeof item === "bigint") {
      sample.push(item.toString());

      continue;
    }

    const value = Number(item);
    sample.push(Number.isFinite(value) ? value : String(value));
  }

  return sample;
}

async function loadOnnxSession(
  manifest: AiPocManifest,
  backendPreference: AiPocRequest["backendPreference"],
): Promise<{
  backend: AiPocBackend;
  fallbackReason?: string;
  webgpu: AiPocWebGpuStatus;
  session: ort.InferenceSession;
}> {
  if (!manifest.artifacts?.model) {
    throw new Error("ONNX manifest is missing artifacts.model");
  }

  ort.env.wasm.wasmPaths = "/static/dist/ai-poc-ort/";
  ort.env.wasm.numThreads = self.crossOriginIsolated ? 0 : 1;

  const failures: string[] = [];
  const webgpu = await probeWorkerWebGpu();
  const candidates = chooseOnnxBackendCandidates(backendPreference, webgpu);

  if (!webgpu.available && backendPreference !== "wasm") {
    failures.push(`webgpu probe: ${webgpu.reason}`);
  }

  for (const backend of candidates) {
    try {
      const session = await ort.InferenceSession.create(
        manifest.artifacts.model,
        {
          executionProviders: [backend],
          graphOptimizationLevel: "all",
        },
      );

      return {
        backend,
        fallbackReason: failures.length > 0 ? failures.join("; ") : undefined,
        webgpu,
        session,
      };
    } catch (err) {
      failures.push(
        `${backend}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  throw new Error(
    `No ONNX Runtime Web backend initialized: ${failures.join("; ")}`,
  );
}

function chooseOnnxBackendCandidates(
  preference: AiPocRequest["backendPreference"],
  webgpu: AiPocWebGpuStatus,
): AiPocBackend[] {
  if (preference === "wasm") {
    return ["wasm"];
  }

  if (preference === "webgpu") {
    return webgpu.available ? ["webgpu"] : [];
  }

  return webgpu.available ? ["webgpu", "wasm"] : ["wasm"];
}

async function probeWorkerWebGpu(): Promise<AiPocWebGpuStatus> {
  if (!self.isSecureContext) {
    return {
      available: false,
      reason: "worker is not in a secure context",
    };
  }

  const gpu = (navigator as Navigator & { gpu?: BrowserGpu }).gpu;
  if (!gpu) {
    return {
      available: false,
      reason: "navigator.gpu is unavailable in worker",
    };
  }

  try {
    const adapter = await gpu.requestAdapter({
      powerPreference: "high-performance",
    });

    if (!adapter) {
      return {
        available: false,
        reason: "navigator.gpu.requestAdapter returned null",
      };
    }

    return { available: true };
  } catch (err) {
    return {
      available: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

async function predictOnnx(
  session: ort.InferenceSession,
  feeds: ort.InferenceSession.FeedsType,
) {
  return session.run(feeds);
}

function summarize(times: number[]) {
  const sorted = [...times].sort((a, b) => a - b);
  const idx = (q: number) =>
    Math.min(sorted.length - 1, Math.floor(q * sorted.length));

  return {
    p50Ms: sorted[idx(0.5)],
    p95Ms: sorted[idx(0.95)],
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
  };
}

async function describeTfOutputs(outputs: Record<string, tf.Tensor>) {
  const entries = [];

  for (const [name, tensor] of Object.entries(outputs)) {
    const data = await tensor.data();

    entries.push({
      name,
      shape: tensor.shape,
      dtype: tensor.dtype,
      sample: Array.from(data.slice(0, 8)),
    });
  }

  return entries;
}

async function describeOnnxOutputs(outputs: ort.InferenceSession.ReturnType) {
  const entries = [];

  for (const [name, value] of Object.entries(outputs)) {
    if (!isOrtTensor(value)) {
      entries.push({
        name,
        shape: [],
        dtype: "non-tensor",
        sample: [],
      });

      continue;
    }

    const data = await value.getData();
    entries.push({
      name,
      shape: Array.from(value.dims),
      dtype: value.type,
      sample: sampleOrtData(data),
    });
  }

  return entries;
}

async function describeMappedOnnxOutputs(
  outputs: ort.InferenceSession.ReturnType,
  outputMap: Record<string, string> | undefined,
) {
  if (!outputMap) {
    return describeOnnxOutputs(outputs);
  }

  const entries = [];

  for (const [name, rawName] of Object.entries(outputMap)) {
    const value = outputs[rawName];

    if (!value) {
      throw new Error(`Mapped ONNX output is missing: ${name} -> ${rawName}`);
    }

    if (!isOrtTensor(value)) {
      entries.push({
        name,
        rawName,
        shape: [],
        dtype: "non-tensor",
        sample: [],
      });

      continue;
    }

    const data = await value.getData();
    entries.push({
      name,
      rawName: rawName === name ? undefined : rawName,
      shape: Array.from(value.dims),
      dtype: value.type,
      sample: sampleOrtData(data),
    });
  }

  return entries;
}

async function interpretOnnxOutputs(
  outputs: ort.InferenceSession.ReturnType,
  boardSize: number,
): Promise<AiPocInterpretation> {
  const policy =
    (await getOrtFloatData(outputs.policy)) ??
    (await getOfficialKatagoPolicyData(outputs, boardSize));
  const value =
    (await getOrtFloatData(outputs.value)) ??
    (await getOrtFloatData(outputs.OutputValue));
  const ownership =
    (await getOrtFloatData(outputs.ownership)) ??
    (await getOrtFloatData(outputs.OutputOwnership));

  return {
    value: value ? interpretValue(value) : undefined,
    topPolicyMoves: policy ? interpretPolicy(policy, boardSize, 8) : undefined,
    ownership: ownership ? summarizeFloatData(ownership) : undefined,
  };
}

async function getOrtFloatData(
  value: ort.OnnxValue | undefined,
): Promise<Float32Array | undefined> {
  if (!value || !isOrtTensor(value) || value.type !== "float32") {
    return undefined;
  }

  return value.getData() as Promise<Float32Array>;
}

async function getOfficialKatagoPolicyData(
  outputs: ort.InferenceSession.ReturnType,
  boardSize: number,
): Promise<Float32Array | undefined> {
  const spatial = await getOrtFloatData(outputs.OutputPolicy);
  const pass = await getOrtFloatData(outputs.OutputPolicyPass);

  if (!spatial || !pass) {
    return undefined;
  }

  const policySize = boardSize * boardSize;
  const policy = new Float32Array(policySize + 1);
  policy.set(spatial.slice(0, policySize), 0);
  policy[policySize] = pass[0] ?? 0;

  return policy;
}

function interpretValue(data: Float32Array) {
  const probs = softmax(Array.from(data.slice(0, 3)));

  return {
    win: probs[0] ?? 0,
    loss: probs[1] ?? 0,
    noResult: probs[2] ?? 0,
  };
}

function sideToMoveValue(data: Float32Array): number {
  const value = interpretValue(data);

  return value.win - value.loss;
}

function interpretPolicy(
  data: Float32Array,
  boardSize: number,
  limit: number,
): AiPocInterpretation["topPolicyMoves"] {
  const policySize = boardSize * boardSize + 1;
  const logits = Array.from(data.slice(0, policySize));
  const probabilities = softmax(logits);

  return probabilities
    .map((probability, index) => ({
      move: policyIndexToMove(index, boardSize),
      probability,
      logit: logits[index] ?? 0,
    }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, limit);
}

function summarizeFloatData(data: Float32Array) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;

  for (const value of data) {
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
  }

  return {
    min,
    max,
    mean: sum / data.length,
  };
}

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((value) => Math.exp(value - max));
  const sum = exps.reduce((total, value) => total + value, 0);

  return exps.map((value) => value / sum);
}

function policyIndexToMove(index: number, boardSize: number): string {
  if (index === boardSize * boardSize) {
    return "pass";
  }

  const col = index % boardSize;
  const row = Math.floor(index / boardSize);

  return `${gtpColumn(col)}${boardSize - row}`;
}

function gtpColumn(col: number): string {
  const code = "A".charCodeAt(0) + col + (col >= 8 ? 1 : 0);

  return String.fromCharCode(code);
}

function disposeTfOutputs(outputs: Record<string, tf.Tensor>) {
  for (const tensor of Object.values(outputs)) {
    tensor.dispose();
  }
}

function disposeOnnxValues(outputs: ort.InferenceSession.ReturnType) {
  for (const value of Object.values(outputs)) {
    if (isOrtTensor(value)) {
      value.dispose();
    }
  }
}

function disposeOnnxFeeds(feeds: ort.InferenceSession.FeedsType) {
  for (const value of Object.values(feeds)) {
    if (isOrtTensor(value)) {
      value.dispose();
    }
  }
}

async function runTfPoc(
  manifest: AiPocManifest,
  manifestMs: number,
  request: Extract<AiPocRequest, { type: "run" }>,
  artifactBytes: number | undefined,
): Promise<AiPocResult> {
  setWasmPaths("/static/dist/ai-poc-wasm/");

  const backendStart = performance.now();
  const backend = await chooseTfBackend();
  const backendMs = performance.now() - backendStart;

  const modelStart = performance.now();
  const model = await loadTfModel(manifest);
  const modelLoadMs = performance.now() - modelStart;
  const input = makeTfInput(request.boardSize);

  const warmupStart = performance.now();
  const warmup = await predictTf(manifest, model, input);
  await Promise.all(Object.values(warmup).map((tensor) => tensor.data()));
  disposeTfOutputs(warmup);
  const warmupMs = performance.now() - warmupStart;

  const runs = Math.max(1, request.runs);
  const times: number[] = [];
  let lastOutputs: Record<string, tf.Tensor> | undefined;

  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    const outputs = await predictTf(manifest, model, input);
    await Promise.all(Object.values(outputs).map((tensor) => tensor.data()));
    times.push(performance.now() - start);

    if (lastOutputs) {
      disposeTfOutputs(lastOutputs);
    }
    lastOutputs = outputs;
  }

  const outputDescriptions = lastOutputs
    ? await describeTfOutputs(lastOutputs)
    : [];

  if (lastOutputs) {
    disposeTfOutputs(lastOutputs);
  }
  input.dispose();
  model?.dispose();

  return {
    manifest,
    runtime: "tfjs",
    backend: backend.backend,
    backendPreference: request.backendPreference,
    fallbackReason: backend.fallbackReason,
    model: {
      artifactBytes,
    },
    timings: {
      workerStartedAt,
      manifestMs,
      backendMs,
      modelLoadMs,
      warmupMs,
      eval: summarize(times),
    },
    outputs: outputDescriptions,
    interpretation: undefined,
    environment: {
      userAgent: navigator.userAgent,
      crossOriginIsolated: self.crossOriginIsolated,
      hardwareConcurrency: navigator.hardwareConcurrency,
    },
  };
}

async function runOnnxPoc(
  manifest: AiPocManifest,
  manifestMs: number,
  request: Extract<AiPocRequest, { type: "run" }>,
  artifactBytes: number | undefined,
): Promise<AiPocResult> {
  const backendStart = performance.now();
  const backendMs = performance.now() - backendStart;

  const modelStart = performance.now();
  const loaded = await loadOnnxSession(manifest, request.backendPreference);
  const modelLoadMs = performance.now() - modelStart;
  const input = makeOnnxFeeds(loaded.session, request);

  const warmupStart = performance.now();
  const warmup = await predictOnnx(loaded.session, input.feeds);
  disposeOnnxValues(warmup);
  const warmupMs = performance.now() - warmupStart;

  const runs = Math.max(1, request.runs);
  const times: number[] = [];
  let lastOutputs: ort.InferenceSession.ReturnType | undefined;

  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    const outputs = await predictOnnx(loaded.session, input.feeds);
    await Promise.all(
      Object.values(outputs).map((value) =>
        isOrtTensor(value) ? value.getData() : Promise.resolve(),
      ),
    );
    times.push(performance.now() - start);

    if (lastOutputs) {
      disposeOnnxValues(lastOutputs);
    }
    lastOutputs = outputs;
  }

  const outputDescriptions = lastOutputs
    ? await describeMappedOnnxOutputs(lastOutputs, manifest.outputMap)
    : [];
  const interpretation = lastOutputs
    ? await interpretOnnxOutputs(lastOutputs, request.boardSize)
    : undefined;
  const modelMetadata = {
    artifactBytes,
    inputNames: Array.from(loaded.session.inputNames),
    outputNames: Array.from(loaded.session.outputNames),
    rawOutputCount: lastOutputs ? Object.keys(lastOutputs).length : 0,
  };

  if (lastOutputs) {
    disposeOnnxValues(lastOutputs);
  }
  disposeOnnxFeeds(input.feeds);
  await loaded.session.release();

  return {
    manifest,
    runtime: "onnxruntime-web",
    backend: loaded.backend,
    backendPreference: request.backendPreference,
    fallbackReason: loaded.fallbackReason,
    model: modelMetadata,
    webgpu: loaded.webgpu,
    input: input.input,
    timings: {
      workerStartedAt,
      manifestMs,
      backendMs,
      modelLoadMs,
      warmupMs,
      eval: summarize(times),
    },
    outputs: outputDescriptions,
    interpretation,
    environment: {
      userAgent: navigator.userAgent,
      crossOriginIsolated: self.crossOriginIsolated,
      hardwareConcurrency: navigator.hardwareConcurrency,
    },
  };
}

async function runOnnxSearch(
  manifest: AiPocManifest,
  request: Extract<AiPocRequest, { type: "search" }>,
): Promise<AiPocSearchResult> {
  const loaded = await loadOnnxSession(manifest, request.backendPreference);
  const rootPosition = createAiPocPosition(
    request.positionPreset,
    request.boardSize,
    request.nextPlayer,
    request.komi,
  );
  let input: AiPocEncodedFeatures["summary"] | undefined;
  const search = await runPolicyMcts(
    rootPosition,
    {
      visits: request.visits,
      maxChildren: request.maxChildren,
    },
    async (position) => {
      const nextInput = makeOnnxFeedsForPosition(loaded.session, position);
      input ??= nextInput.input;
      const outputs = await predictOnnx(loaded.session, nextInput.feeds);

      try {
        const policy =
          (await getOrtFloatData(outputs.policy)) ??
          (await getOfficialKatagoPolicyData(outputs, position.boardSize));
        const valueData =
          (await getOrtFloatData(outputs.value)) ??
          (await getOrtFloatData(outputs.OutputValue));

        if (!policy) {
          throw new Error("ONNX output is missing a policy tensor");
        }

        return {
          policy,
          value: valueData ? sideToMoveValue(valueData) : 0,
        };
      } finally {
        disposeOnnxValues(outputs);
        disposeOnnxFeeds(nextInput.feeds);
      }
    },
  );
  const modelMetadata = {
    inputNames: Array.from(loaded.session.inputNames),
    outputNames: Array.from(loaded.session.outputNames),
  };

  await loaded.session.release();

  return {
    manifest,
    runtime: "onnxruntime-web",
    backend: loaded.backend,
    backendPreference: request.backendPreference,
    fallbackReason: loaded.fallbackReason,
    model: modelMetadata,
    webgpu: loaded.webgpu,
    input,
    search,
    environment: {
      userAgent: navigator.userAgent,
      crossOriginIsolated: self.crossOriginIsolated,
      hardwareConcurrency: navigator.hardwareConcurrency,
    },
  };
}

async function runOnnxRustPolicyMcts(
  manifest: AiPocManifest,
  request: Extract<AiPocRequest, { type: "rust-policy-mcts" }>,
): Promise<AiPocRandomMctsResult> {
  const totalStartedAt = performance.now();
  const modelLoadStartedAt = performance.now();
  const loaded = await loadOnnxSession(manifest, request.backendPreference);
  const modelLoadMs = performance.now() - modelLoadStartedAt;
  const rootPosition = createAiPocPosition(
    request.positionPreset,
    request.boardSize,
    request.nextPlayer,
    request.komi,
  );
  const rootInferenceStartedAt = performance.now();
  const input = makeOnnxFeedsForPosition(loaded.session, rootPosition);
  const outputs = await predictOnnx(loaded.session, input.feeds);

  try {
    const policy =
      (await getOrtFloatData(outputs.policy)) ??
      (await getOfficialKatagoPolicyData(outputs, rootPosition.boardSize));
    const valueData =
      (await getOrtFloatData(outputs.value)) ??
      (await getOrtFloatData(outputs.OutputValue));

    if (!policy) {
      throw new Error("ONNX output is missing a policy tensor");
    }
    const rootInferenceMs = performance.now() - rootInferenceStartedAt;

    return await runRandomMcts(request, {
      rootPolicyLogits: new Float32Array(policy),
      rootValue: valueData ? sideToMoveValue(valueData) : undefined,
      totalStartedAt,
      modelLoadMs,
      rootInferenceMs,
      manifest,
      policyRuntime: "onnxruntime-web",
      backend: loaded.backend,
      backendPreference: request.backendPreference,
      fallbackReason: loaded.fallbackReason,
      model: {
        inputNames: Array.from(loaded.session.inputNames),
        outputNames: Array.from(loaded.session.outputNames),
      },
      webgpu: loaded.webgpu,
    });
  } finally {
    disposeOnnxValues(outputs);
    disposeOnnxFeeds(input.feeds);
    await loaded.session.release();
  }
}

async function runOnnxRustLeafPolicyMcts(
  manifest: AiPocManifest,
  request: Extract<AiPocRequest, { type: "rust-leaf-policy-mcts" }>,
): Promise<AiPocRandomMctsResult> {
  const totalStartedAt = performance.now();
  const modelLoadStartedAt = performance.now();
  const loaded = await loadOnnxSession(manifest, request.backendPreference);
  const modelLoadMs = performance.now() - modelLoadStartedAt;

  try {
    return await runLeafPolicyMcts(request, {
      totalStartedAt,
      modelLoadMs,
      manifest,
      policyRuntime: "onnxruntime-web",
      backend: loaded.backend,
      backendPreference: request.backendPreference,
      fallbackReason: loaded.fallbackReason,
      model: {
        inputNames: Array.from(loaded.session.inputNames),
        outputNames: Array.from(loaded.session.outputNames),
      },
      webgpu: loaded.webgpu,
      evaluate: async (position) => {
        const startedAt = performance.now();
        const input = makeOnnxFeedsForPosition(loaded.session, position);
        const outputs = await predictOnnx(loaded.session, input.feeds);

        try {
          const policy =
            (await getOrtFloatData(outputs.policy)) ??
            (await getOfficialKatagoPolicyData(outputs, position.boardSize));
          const valueData =
            (await getOrtFloatData(outputs.value)) ??
            (await getOrtFloatData(outputs.OutputValue));

          if (!policy) {
            throw new Error("ONNX output is missing a policy tensor");
          }

          return {
            policy: new Float32Array(policy),
            value: valueData ? sideToMoveValue(valueData) : 0,
            elapsedMs: performance.now() - startedAt,
          };
        } finally {
          disposeOnnxValues(outputs);
          disposeOnnxFeeds(input.feeds);
        }
      },
    });
  } finally {
    await loaded.session.release();
  }
}

async function runPoc(
  request: Extract<AiPocRequest, { type: "run" }>,
): Promise<AiPocResult> {
  const manifestStart = performance.now();
  const manifest = await fetchManifest(request.manifestUrl);
  const manifestMs = performance.now() - manifestStart;
  const artifactBytes = manifest.artifacts?.model
    ? await fetchContentLength(manifest.artifacts.model)
    : undefined;

  if (!manifest.boardSizes.includes(request.boardSize)) {
    throw new Error(
      `Model ${manifest.id} does not support ${request.boardSize}x${request.boardSize}`,
    );
  }

  if (manifest.kind === "onnx") {
    return runOnnxPoc(manifest, manifestMs, request, artifactBytes);
  }

  return runTfPoc(manifest, manifestMs, request, artifactBytes);
}

async function runSearch(
  request: Extract<AiPocRequest, { type: "search" }>,
): Promise<AiPocSearchResult> {
  const manifest = await fetchManifest(request.manifestUrl);

  if (!manifest.boardSizes.includes(request.boardSize)) {
    throw new Error(
      `Model ${manifest.id} does not support ${request.boardSize}x${request.boardSize}`,
    );
  }

  if (manifest.kind !== "onnx") {
    throw new Error("Policy MCTS PoC requires an ONNX model");
  }

  return runOnnxSearch(manifest, request);
}

async function runRustPolicyMcts(
  request: Extract<AiPocRequest, { type: "rust-policy-mcts" }>,
): Promise<AiPocRandomMctsResult> {
  const manifest = await fetchManifest(request.manifestUrl);

  if (!manifest.boardSizes.includes(request.boardSize)) {
    throw new Error(
      `Model ${manifest.id} does not support ${request.boardSize}x${request.boardSize}`,
    );
  }

  if (manifest.kind !== "onnx") {
    throw new Error("Rust policy MCTS PoC requires an ONNX model");
  }

  return runOnnxRustPolicyMcts(manifest, request);
}

async function runRustLeafPolicyMcts(
  request: Extract<AiPocRequest, { type: "rust-leaf-policy-mcts" }>,
): Promise<AiPocRandomMctsResult> {
  const manifest = await fetchManifest(request.manifestUrl);

  if (!manifest.boardSizes.includes(request.boardSize)) {
    throw new Error(
      `Model ${manifest.id} does not support ${request.boardSize}x${request.boardSize}`,
    );
  }

  if (manifest.kind !== "onnx") {
    throw new Error("Rust leaf-policy MCTS PoC requires an ONNX model");
  }

  return runOnnxRustLeafPolicyMcts(manifest, request);
}

self.addEventListener("message", (event: MessageEvent<AiPocRequest>) => {
  const request = event.data;

  const result =
    request.type === "run"
      ? runPoc(request)
      : request.type === "search"
        ? runSearch(request)
        : request.type === "rust-policy-mcts"
          ? runRustPolicyMcts(request)
          : request.type === "rust-leaf-policy-mcts"
            ? runRustLeafPolicyMcts(request)
            : runRandomMcts(request);

  result
    .then((result) => post({ id: request.id, type: "result", result }))
    .catch((err) =>
      post({
        id: request.id,
        type: "error",
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      }),
    );
});
