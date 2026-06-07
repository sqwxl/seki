import type {
  AiAnalyzePositionResult,
  AiPocDirectPolicyResult,
  AiPocRandomMctsResult,
  AiPocRequest,
  AiPocResponse,
  AiPocResult,
  AiPocSearchResult,
} from "./types";

const defaultManifest = "/static/models/lionffen-b6c64-19x19/manifest.json";

type MctsPreset = {
  id: string;
  label: string;
  visits: number;
  maxChildren: number;
  batchSize: number;
  fpuReduction: number;
};

const mctsPresets = [
  {
    id: "android-fast",
    label: "Android fast (64 / 16 / 16)",
    visits: 64,
    maxChildren: 16,
    batchSize: 16,
    fpuReduction: 0.2,
  },
  {
    id: "tuning-fpu",
    label: "Tuning (64 / 16 / 4 / FPU 0.5)",
    visits: 64,
    maxChildren: 16,
    batchSize: 4,
    fpuReduction: 0.5,
  },
  {
    id: "android-strong",
    label: "Android stronger (96 / 16 / 16)",
    visits: 96,
    maxChildren: 16,
    batchSize: 16,
    fpuReduction: 0.2,
  },
  {
    id: "lab-128",
    label: "Lab 128 (128 / 16 / 16)",
    visits: 128,
    maxChildren: 16,
    batchSize: 16,
    fpuReduction: 0.2,
  },
] satisfies MctsPreset[];

const defaultMctsPreset = mctsPresets[0];
const proGamePositionPresets = new Set([
  "li-jiang-move-32",
  "li-jiang-move-72",
  "li-jiang-move-120",
]);
const kataGo9x9PositionPresets = new Map([
  ["katago-search-sparse-9x9", "black"],
  ["katago-local-contact-9x9", "white"],
]);

const app = document.querySelector<HTMLDivElement>("#ai-poc");

if (!app) {
  throw new Error("Missing #ai-poc root");
}

app.innerHTML = `
  <section class="ai-poc-panel">
    <div>
      <label for="manifest-url">Manifest</label>
      <select id="manifest-url">
        <option value="/static/models/lionffen-b6c64-19x19/manifest.json" selected>Lionffen b6c64 official ONNX</option>
        <option value="/static/models/kata9x9-b18c384nbt-20231025/manifest.json">KataGo 9x9 b18c384nbt official ONNX</option>
        <option value="/static/models/kaya-b28c512-uint8/manifest.json">Kaya b28c512 uint8 ONNX</option>
        <option value="/static/models/ai-poc-synthetic/manifest.json">Synthetic runtime check</option>
      </select>
    </div>
    <div>
      <label for="board-size">Board size</label>
      <select id="board-size">
        <option value="9">9x9</option>
        <option value="13">13x13</option>
        <option value="19" selected>19x19</option>
      </select>
    </div>
    <div>
      <label for="position-preset">Position</label>
      <select id="position-preset">
        <option value="empty" selected>Empty board</option>
        <option value="corner-exchange">Corner exchange</option>
        <option value="katago-search-sparse-9x9">KataGo sparse 9x9</option>
        <option value="katago-local-contact-9x9">KataGo local contact 9x9</option>
        <option value="li-jiang-move-32">Li Xiangyu vs Jiang Weijie, move 32</option>
        <option value="li-jiang-move-72">Li Xiangyu vs Jiang Weijie, move 72</option>
        <option value="li-jiang-move-120">Li Xiangyu vs Jiang Weijie, move 120</option>
      </select>
    </div>
    <div>
      <label for="next-player">Next player</label>
      <select id="next-player">
        <option value="black" selected>Black</option>
        <option value="white">White</option>
      </select>
    </div>
    <div>
      <label for="komi">Komi</label>
      <input id="komi" type="number" step="0.5" value="6.5" />
    </div>
    <div>
      <label for="backend-preference">Backend</label>
      <select id="backend-preference">
        <option value="auto" selected>Auto</option>
        <option value="webgpu">WebGPU</option>
        <option value="wasm">WASM</option>
      </select>
    </div>
    <div>
      <label for="runs">Runs</label>
      <input id="runs" type="number" min="1" max="200" value="30" />
    </div>
    <div>
      <label for="mcts-preset">MCTS preset</label>
      <select id="mcts-preset">
        ${mctsPresets
          .map(
            (preset) =>
              `<option value="${preset.id}"${preset.id === defaultMctsPreset.id ? " selected" : ""}>${preset.label}</option>`,
          )
          .join("")}
        <option value="custom">Custom</option>
      </select>
    </div>
    <div>
      <label for="mcts-visits">MCTS visits</label>
      <input id="mcts-visits" type="number" min="1" max="200" value="${defaultMctsPreset.visits}" />
    </div>
    <div>
      <label for="mcts-max-children">MCTS max children</label>
      <input id="mcts-max-children" type="number" min="1" max="100" value="${defaultMctsPreset.maxChildren}" />
    </div>
    <div>
      <label for="mcts-batch-size">MCTS eval batch</label>
      <input id="mcts-batch-size" type="number" min="1" max="64" value="${defaultMctsPreset.batchSize}" />
    </div>
    <div>
      <label for="mcts-fpu-reduction">FPU reduction</label>
      <input id="mcts-fpu-reduction" type="number" min="0" max="2" step="0.1" value="0.2" />
    </div>
    <div>
      <label for="policy-optimism">Policy optimism</label>
      <input id="policy-optimism" type="number" min="0" max="1" step="0.1" value="0" />
    </div>
    <div>
      <label for="rollout-limit">Rollout limit</label>
      <input id="rollout-limit" type="number" min="1" max="500" value="120" />
    </div>
    <div>
      <label for="mcts-seed">MCTS seed</label>
      <input id="mcts-seed" type="number" min="0" value="99" />
    </div>
    <button id="run-poc" type="button">Run inference</button>
    <button id="run-direct-policy" type="button">Run direct policy</button>
    <button id="run-search" type="button">Run policy MCTS</button>
    <button id="run-rust-policy-mcts" type="button">Run Rust root-policy MCTS</button>
    <button id="run-rust-leaf-policy-mcts" type="button">Run Rust leaf-policy MCTS</button>
    <button id="run-random-mcts" type="button">Run Rust random MCTS</button>
  </section>
  <section class="ai-poc-actions">
    <button id="copy-result" type="button" disabled>Copy JSON</button>
    <button id="download-result" type="button" disabled>Download JSON</button>
  </section>
  <pre id="ai-poc-output">Idle.</pre>
`;

const manifestInput =
  document.querySelector<HTMLSelectElement>("#manifest-url")!;
const sizeInput = document.querySelector<HTMLSelectElement>("#board-size")!;
const positionPresetInput =
  document.querySelector<HTMLSelectElement>("#position-preset")!;
const nextPlayerInput =
  document.querySelector<HTMLSelectElement>("#next-player")!;
const komiInput = document.querySelector<HTMLInputElement>("#komi")!;
const backendPreferenceInput = document.querySelector<HTMLSelectElement>(
  "#backend-preference",
)!;
const runsInput = document.querySelector<HTMLInputElement>("#runs")!;
const mctsPresetInput =
  document.querySelector<HTMLSelectElement>("#mcts-preset")!;
const visitsInput = document.querySelector<HTMLInputElement>("#mcts-visits")!;
const maxChildrenInput =
  document.querySelector<HTMLInputElement>("#mcts-max-children")!;
const batchSizeInput =
  document.querySelector<HTMLInputElement>("#mcts-batch-size")!;
const fpuReductionInput = document.querySelector<HTMLInputElement>(
  "#mcts-fpu-reduction",
)!;
const policyOptimismInput =
  document.querySelector<HTMLInputElement>("#policy-optimism")!;
const rolloutLimitInput =
  document.querySelector<HTMLInputElement>("#rollout-limit")!;
const seedInput = document.querySelector<HTMLInputElement>("#mcts-seed")!;
const runButton = document.querySelector<HTMLButtonElement>("#run-poc")!;
const directPolicyButton =
  document.querySelector<HTMLButtonElement>("#run-direct-policy")!;
const searchButton = document.querySelector<HTMLButtonElement>("#run-search")!;
const rustPolicyMctsButton = document.querySelector<HTMLButtonElement>(
  "#run-rust-policy-mcts",
)!;
const rustLeafPolicyMctsButton = document.querySelector<HTMLButtonElement>(
  "#run-rust-leaf-policy-mcts",
)!;
const randomMctsButton =
  document.querySelector<HTMLButtonElement>("#run-random-mcts")!;
const copyButton = document.querySelector<HTMLButtonElement>("#copy-result")!;
const downloadButton =
  document.querySelector<HTMLButtonElement>("#download-result")!;
const output = document.querySelector<HTMLPreElement>("#ai-poc-output")!;

let worker: Worker | undefined;
let lastResultText: string | undefined;

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker("/static/dist/ai-poc-worker.js", { type: "module" });
  }

  return worker;
}

function formatResult(
  result:
    | AiPocResult
    | AiPocSearchResult
    | AiPocDirectPolicyResult
    | AiPocRandomMctsResult
    | AiAnalyzePositionResult,
): string {
  if ("analysis" in result) {
    return JSON.stringify(
      {
        analysis: {
          model: result.manifest.id,
          runtime: result.runtime,
          policyRuntime: result.policyRuntime,
          backend: result.backend,
          backendPreference: result.backendPreference,
          boardSize: result.input.boardSize,
          nextPlayer: result.input.nextPlayer,
          preset: result.analysis.preset,
          policyOptimism: result.analysis.policyOptimism,
          visits: result.analysis.visits,
          maxPolicyActions: result.analysis.maxPolicyActions,
          batchSize: result.analysis.batchSize,
          fpuReduction: result.analysis.fpuReduction,
          bestMove: result.analysis.bestMove,
          winrate: result.analysis.winrate,
          rootValue: result.analysis.rootValue,
          scoreMean: result.analysis.scoreMean,
          ownership: result.analysis.ownership,
          timings: result.analysis.timings,
          rootMoves: result.analysis.rootMoves.slice(0, 12),
          principalVariation: result.analysis.principalVariation,
          principalVariationMoves: result.analysis.principalVariationMoves,
          diagnostics: result.analysis.diagnostics,
        },
        manifest: {
          id: result.manifest.id,
          kind: result.manifest.kind,
          version: result.manifest.version,
        },
        runtime: result.runtime,
        policyRuntime: result.policyRuntime,
        backend: result.backend,
        backendPreference: result.backendPreference,
        fallbackReason: result.fallbackReason,
        model: result.model,
        outputs: result.outputs,
        webgpu: result.webgpu,
        input: result.input,
        environment: result.environment,
      },
      null,
      2,
    );
  }

  if ("directPolicy" in result) {
    return JSON.stringify(
      {
        directPolicy: {
          model: result.manifest.id,
          runtime: result.runtime,
          policyRuntime: result.policyRuntime,
          backend: result.backend,
          backendPreference: result.backendPreference,
          boardSize: result.input.boardSize,
          positionPreset: result.input.positionPreset,
          nextPlayer: result.input.nextPlayer,
          maxPolicyActions: result.directPolicy.maxPolicyActions,
          policyOptimism: result.directPolicy.policyOptimism,
          modelLoadMs: result.directPolicy.modelLoadMs,
          modelEvalMs: result.directPolicy.modelEvalMs,
          totalElapsedMs: result.directPolicy.totalElapsedMs,
          bestMove: result.directPolicy.bestMove,
          winrate: result.directPolicy.winrate,
          rootValue: result.directPolicy.rootValue,
          scoreMean: result.directPolicy.scoreMean,
          ownership: result.directPolicy.ownership,
          policySource: result.directPolicy.policySource,
          valueSource: result.directPolicy.valueSource,
          legalMoves: result.directPolicy.legalMoves,
        },
        manifest: {
          id: result.manifest.id,
          kind: result.manifest.kind,
          version: result.manifest.version,
        },
        fallbackReason: result.fallbackReason,
        model: result.model,
        outputs: result.outputs,
        webgpu: result.webgpu,
        input: result.input,
        environment: result.environment,
      },
      null,
      2,
    );
  }

  if ("randomSearch" in result) {
    return JSON.stringify(
      {
        randomSearch: {
          runtime: result.runtime,
          boardSize: result.input.boardSize,
          positionPreset: result.input.positionPreset,
          nextPlayer: result.input.nextPlayer,
          visits: result.randomSearch.visits,
          rolloutLimit: result.randomSearch.rolloutLimit,
          maxPolicyActions: result.randomSearch.maxPolicyActions,
          fpuReduction: result.randomSearch.fpuReduction,
          policyOptimism: result.randomSearch.policyOptimism,
          seed: result.randomSearch.seed,
          elapsedMs: result.randomSearch.elapsedMs,
          modelLoadMs: result.randomSearch.modelLoadMs,
          rootInferenceMs: result.randomSearch.rootInferenceMs,
          wasmSearchMs: result.randomSearch.wasmSearchMs,
          totalElapsedMs: result.randomSearch.totalElapsedMs,
          modelEvaluations: result.randomSearch.modelEvaluations,
          modelBatches: result.randomSearch.modelBatches,
          modelEvalMs: result.randomSearch.modelEvalMs,
          batchSize: result.randomSearch.batchSize,
          bestMove: result.randomSearch.bestMove,
          winrate: result.randomSearch.winrate,
          rootValue: result.randomSearch.rootValue,
          policySource: result.randomSearch.policySource,
          valueSource: result.randomSearch.valueSource,
          rootPolicyMoves: result.randomSearch.rootPolicyMoves?.slice(0, 12),
          rootEdges: result.randomSearch.rootEdges.slice(0, 12),
          principalVariation: result.randomSearch.principalVariation,
          principalVariationMoves: result.randomSearch.principalVariationMoves,
          diagnostics: result.randomSearch.diagnostics,
        },
        manifest: result.manifest
          ? {
              id: result.manifest.id,
              kind: result.manifest.kind,
              version: result.manifest.version,
            }
          : undefined,
        input: result.input,
        policyRuntime: result.policyRuntime,
        backend: result.backend,
        backendPreference: result.backendPreference,
        fallbackReason: result.fallbackReason,
        model: result.model,
        webgpu: result.webgpu,
        environment: result.environment,
      },
      null,
      2,
    );
  }

  if ("search" in result) {
    return JSON.stringify(
      {
        search: {
          model: result.manifest.id,
          runtime: result.runtime,
          backend: result.backend,
          backendPreference: result.backendPreference,
          boardSize: result.input?.boardSize,
          positionPreset: positionPresetInput.value,
          visits: result.search.visits,
          maxChildren: result.search.maxChildren,
          policyOptimism: Number(policyOptimismInput.value),
          elapsedMs: result.search.elapsedMs,
          bestMove: result.search.bestMove,
          rootValue: result.search.rootValue,
          topMoves: result.search.topMoves,
        },
        manifest: {
          id: result.manifest.id,
          kind: result.manifest.kind,
          version: result.manifest.version,
        },
        runtime: result.runtime,
        backend: result.backend,
        backendPreference: result.backendPreference,
        fallbackReason: result.fallbackReason,
        model: result.model,
        webgpu: result.webgpu,
        input: result.input,
        environment: result.environment,
      },
      null,
      2,
    );
  }

  return JSON.stringify(
    {
      benchmark: {
        model: result.manifest.id,
        runtime: result.runtime,
        backend: result.backend,
        backendPreference: result.backendPreference,
        boardSize: result.input?.boardSize,
        positionPreset: positionPresetInput.value,
        policyOptimism: Number(policyOptimismInput.value),
        runs: Number(runsInput.value),
        p50Ms: result.timings.eval.p50Ms,
        p95Ms: result.timings.eval.p95Ms,
        modelLoadMs: result.timings.modelLoadMs,
        warmupMs: result.timings.warmupMs,
      },
      manifest: {
        id: result.manifest.id,
        kind: result.manifest.kind,
        version: result.manifest.version,
      },
      runtime: result.runtime,
      backend: result.backend,
      backendPreference: result.backendPreference,
      fallbackReason: result.fallbackReason,
      model: result.model,
      webgpu: result.webgpu,
      input: result.input,
      timings: result.timings,
      outputs: result.outputs,
      interpretation: result.interpretation,
      environment: result.environment,
    },
    null,
    2,
  );
}

function baseRequest() {
  return {
    id: crypto.randomUUID(),
    manifestUrl: manifestInput.value,
    boardSize: Number(sizeInput.value),
    positionPreset: positionPresetInput.value,
    nextPlayer: nextPlayerInput.value as "black" | "white",
    komi: Number(komiInput.value),
    backendPreference:
      backendPreferenceInput.value as AiPocRequest["backendPreference"],
    policyOptimism: Number(policyOptimismInput.value),
  };
}

function applyMctsPreset(presetId: string) {
  const preset = mctsPresets.find((candidate) => candidate.id === presetId);

  if (!preset) {
    return;
  }

  visitsInput.value = String(preset.visits);
  maxChildrenInput.value = String(preset.maxChildren);
  batchSizeInput.value = String(preset.batchSize);
  fpuReductionInput.value = String(preset.fpuReduction);
}

function syncMctsPresetSelection() {
  const matchingPreset = mctsPresets.find(
    (preset) =>
      Number(visitsInput.value) === preset.visits &&
      Number(maxChildrenInput.value) === preset.maxChildren &&
      Number(batchSizeInput.value) === preset.batchSize &&
      Number(fpuReductionInput.value) === preset.fpuReduction,
  );

  mctsPresetInput.value = matchingPreset?.id ?? "custom";
}

function syncPositionPresetMetadata() {
  if (!proGamePositionPresets.has(positionPresetInput.value)) {
    const kataGoNextPlayer = kataGo9x9PositionPresets.get(
      positionPresetInput.value,
    );

    if (kataGoNextPlayer) {
      sizeInput.value = "9";
      nextPlayerInput.value = kataGoNextPlayer;
      komiInput.value = "6.5";
    }

    return;
  }

  sizeInput.value = "19";
  nextPlayerInput.value = "black";
  komiInput.value = "7.5";
}

function runPoc() {
  const request: AiPocRequest = {
    ...baseRequest(),
    type: "run",
    runs: Number(runsInput.value),
  };

  postRequest(request, "Running...");
}

function runSearch() {
  const request: AiPocRequest = {
    ...baseRequest(),
    type: "search",
    visits: Number(visitsInput.value),
    maxChildren: Number(maxChildrenInput.value),
  };

  postRequest(request, "Searching...");
}

function runDirectPolicy() {
  const request: AiPocRequest = {
    ...baseRequest(),
    type: "direct-policy",
    maxPolicyActions: Number(maxChildrenInput.value),
  };

  postRequest(request, "Running direct policy...");
}

function runRandomMcts() {
  const request: AiPocRequest = {
    ...baseRequest(),
    type: "random-mcts",
    visits: Number(visitsInput.value),
    rolloutLimit: Number(rolloutLimitInput.value),
    maxPolicyActions: Number(maxChildrenInput.value),
    fpuReduction: Number(fpuReductionInput.value),
    seed: Number(seedInput.value),
  };

  postRequest(request, "Running Rust MCTS...");
}

function runRustPolicyMcts() {
  const request: AiPocRequest = {
    ...baseRequest(),
    type: "rust-policy-mcts",
    visits: Number(visitsInput.value),
    rolloutLimit: Number(rolloutLimitInput.value),
    maxPolicyActions: Number(maxChildrenInput.value),
    fpuReduction: Number(fpuReductionInput.value),
    seed: Number(seedInput.value),
  };

  postRequest(request, "Running Rust root-policy MCTS...");
}

function runRustLeafPolicyMcts() {
  const request: AiPocRequest = {
    ...baseRequest(),
    type: "rust-leaf-policy-mcts",
    visits: Number(visitsInput.value),
    maxPolicyActions: Number(maxChildrenInput.value),
    batchSize: Number(batchSizeInput.value),
    fpuReduction: Number(fpuReductionInput.value),
  };

  postRequest(request, "Running Rust leaf-policy MCTS...");
}

function postRequest(request: AiPocRequest, runningText: string) {
  const activeWorker = ensureWorker();

  runButton.disabled = true;
  directPolicyButton.disabled = true;
  searchButton.disabled = true;
  rustPolicyMctsButton.disabled = true;
  rustLeafPolicyMctsButton.disabled = true;
  randomMctsButton.disabled = true;
  copyButton.disabled = true;
  downloadButton.disabled = true;
  lastResultText = undefined;
  output.textContent = runningText;

  const onMessage = (event: MessageEvent<AiPocResponse>) => {
    const response = event.data;

    if (response.id !== request.id) {
      return;
    }

    activeWorker.removeEventListener("message", onMessage);
    runButton.disabled = false;
    directPolicyButton.disabled = false;
    searchButton.disabled = false;
    rustPolicyMctsButton.disabled = false;
    rustLeafPolicyMctsButton.disabled = false;
    randomMctsButton.disabled = false;

    if (response.type === "error") {
      output.textContent = response.stack ?? response.message;

      return;
    }

    lastResultText = formatResult(response.result);
    output.textContent = lastResultText;
    copyButton.disabled = false;
    downloadButton.disabled = false;
  };

  activeWorker.addEventListener("message", onMessage);
  activeWorker.postMessage(request);
}

runButton.addEventListener("click", runPoc);
directPolicyButton.addEventListener("click", runDirectPolicy);
searchButton.addEventListener("click", runSearch);
rustPolicyMctsButton.addEventListener("click", runRustPolicyMcts);
rustLeafPolicyMctsButton.addEventListener("click", runRustLeafPolicyMcts);
randomMctsButton.addEventListener("click", runRandomMcts);
mctsPresetInput.addEventListener("change", () => {
  applyMctsPreset(mctsPresetInput.value);
});
positionPresetInput.addEventListener("change", syncPositionPresetMetadata);
for (const input of [
  visitsInput,
  maxChildrenInput,
  batchSizeInput,
  fpuReductionInput,
]) {
  input.addEventListener("input", syncMctsPresetSelection);
}
copyButton.addEventListener("click", () => {
  if (lastResultText) {
    navigator.clipboard.writeText(lastResultText).catch(() => {
      output.textContent = lastResultText!;
    });
  }
});
downloadButton.addEventListener("click", () => {
  if (!lastResultText) {
    return;
  }

  const blob = new Blob([lastResultText], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");

  link.href = url;
  link.download = `seki-ai-poc-${timestamp}.json`;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  window.setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 1_000);
});

if (new URLSearchParams(window.location.search).get("autorun") === "1") {
  runPoc();
}
