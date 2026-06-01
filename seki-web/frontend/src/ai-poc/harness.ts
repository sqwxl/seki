import type { AiPocRequest, AiPocResponse, AiPocResult } from "./types";

const defaultManifest = "/static/models/kaya-b28c512-uint8/manifest.json";

const app = document.querySelector<HTMLDivElement>("#ai-poc");

if (!app) {
  throw new Error("Missing #ai-poc root");
}

app.innerHTML = `
  <section class="ai-poc-panel">
    <div>
      <label for="manifest-url">Manifest</label>
      <input id="manifest-url" type="text" value="${defaultManifest}" />
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
      <label for="runs">Runs</label>
      <input id="runs" type="number" min="1" max="200" value="30" />
    </div>
    <button id="run-poc" type="button">Run inference</button>
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
const runsInput = document.querySelector<HTMLInputElement>("#runs")!;
const runButton = document.querySelector<HTMLButtonElement>("#run-poc")!;
const output = document.querySelector<HTMLPreElement>("#ai-poc-output")!;

let worker: Worker | undefined;

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker("/static/dist/ai-poc-worker.js", { type: "module" });
  }

  return worker;
}

function formatResult(result: AiPocResult): string {
  return JSON.stringify(
    {
      manifest: {
        id: result.manifest.id,
        kind: result.manifest.kind,
        version: result.manifest.version,
      },
      runtime: result.runtime,
      backend: result.backend,
      fallbackReason: result.fallbackReason,
      model: result.model,
      input: result.input,
      timings: result.timings,
      outputs: result.outputs,
      environment: result.environment,
    },
    null,
    2,
  );
}

function runPoc() {
  const id = crypto.randomUUID();
  const request: AiPocRequest = {
    id,
    type: "run",
    manifestUrl: manifestInput.value,
    boardSize: Number(sizeInput.value),
    positionPreset: positionPresetInput.value,
    nextPlayer: nextPlayerInput.value as "black" | "white",
    komi: Number(komiInput.value),
    runs: Number(runsInput.value),
  };
  const activeWorker = ensureWorker();

  runButton.disabled = true;
  output.textContent = "Running...";

  const onMessage = (event: MessageEvent<AiPocResponse>) => {
    const response = event.data;

    if (response.id !== id) {
      return;
    }

    activeWorker.removeEventListener("message", onMessage);
    runButton.disabled = false;

    if (response.type === "error") {
      output.textContent = response.stack ?? response.message;

      return;
    }

    output.textContent = formatResult(response.result);
  };

  activeWorker.addEventListener("message", onMessage);
  activeWorker.postMessage(request);
}

runButton.addEventListener("click", runPoc);

if (new URLSearchParams(window.location.search).get("autorun") === "1") {
  runPoc();
}
