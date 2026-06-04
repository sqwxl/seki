import type {
  AiPocRandomMctsResult,
  AiPocRequest,
  AiPocResponse,
  AiPocResult,
  AiPocSearchResult,
} from "./types";

const defaultManifest = "/static/models/lionffen-b6c64-19x19/manifest.json";

const app = document.querySelector<HTMLDivElement>("#ai-poc");

if (!app) {
  throw new Error("Missing #ai-poc root");
}

app.innerHTML = `
  <section class="ai-poc-panel">
    <div>
      <label for="manifest-url">Manifest</label>
      <input id="manifest-url" type="text" list="manifest-options" value="${defaultManifest}" />
      <datalist id="manifest-options">
        <option value="/static/models/lionffen-b6c64-19x19/manifest.json">Lionffen b6c64 official ONNX</option>
        <option value="/static/models/kaya-b28c512-uint8/manifest.json">Kaya b28c512 uint8 ONNX</option>
        <option value="/static/models/ai-poc-synthetic/manifest.json">Synthetic runtime check</option>
      </datalist>
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
      <label for="mcts-visits">MCTS visits</label>
      <input id="mcts-visits" type="number" min="1" max="200" value="24" />
    </div>
    <div>
      <label for="mcts-max-children">MCTS max children</label>
      <input id="mcts-max-children" type="number" min="1" max="100" value="32" />
    </div>
    <div>
      <label for="mcts-batch-size">MCTS eval batch</label>
      <input id="mcts-batch-size" type="number" min="1" max="64" value="8" />
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
  document.querySelector<HTMLInputElement>("#manifest-url")!;
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
const visitsInput = document.querySelector<HTMLInputElement>("#mcts-visits")!;
const maxChildrenInput =
  document.querySelector<HTMLInputElement>("#mcts-max-children")!;
const batchSizeInput =
  document.querySelector<HTMLInputElement>("#mcts-batch-size")!;
const rolloutLimitInput =
  document.querySelector<HTMLInputElement>("#rollout-limit")!;
const seedInput = document.querySelector<HTMLInputElement>("#mcts-seed")!;
const runButton = document.querySelector<HTMLButtonElement>("#run-poc")!;
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
  result: AiPocResult | AiPocSearchResult | AiPocRandomMctsResult,
): string {
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
          seed: result.randomSearch.seed,
          elapsedMs: result.randomSearch.elapsedMs,
          modelLoadMs: result.randomSearch.modelLoadMs,
          rootInferenceMs: result.randomSearch.rootInferenceMs,
          wasmSearchMs: result.randomSearch.wasmSearchMs,
          totalElapsedMs: result.randomSearch.totalElapsedMs,
          modelEvaluations: result.randomSearch.modelEvaluations,
          modelEvalMs: result.randomSearch.modelEvalMs,
          batchSize: result.randomSearch.batchSize,
          bestMove: result.randomSearch.bestMove,
          winrate: result.randomSearch.winrate,
          rootValue: result.randomSearch.rootValue,
          policySource: result.randomSearch.policySource,
          valueSource: result.randomSearch.valueSource,
          rootEdges: result.randomSearch.rootEdges.slice(0, 12),
          principalVariation: result.randomSearch.principalVariation,
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
  };
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

function runRandomMcts() {
  const request: AiPocRequest = {
    ...baseRequest(),
    type: "random-mcts",
    visits: Number(visitsInput.value),
    rolloutLimit: Number(rolloutLimitInput.value),
    maxPolicyActions: Number(maxChildrenInput.value),
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
  };

  postRequest(request, "Running Rust leaf-policy MCTS...");
}

function postRequest(request: AiPocRequest, runningText: string) {
  const activeWorker = ensureWorker();

  runButton.disabled = true;
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
searchButton.addEventListener("click", runSearch);
rustPolicyMctsButton.addEventListener("click", runRustPolicyMcts);
rustLeafPolicyMctsButton.addEventListener("click", runRustLeafPolicyMcts);
randomMctsButton.addEventListener("click", runRandomMcts);
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

  link.href = url;
  link.download = `seki-ai-poc-${new Date().toISOString()}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

if (new URLSearchParams(window.location.search).get("autorun") === "1") {
  runPoc();
}
