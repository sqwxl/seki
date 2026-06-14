import type { AiPocPosition } from "../ai-poc/feature-encoder";
import type {
  AiAnalyzePositionResult,
  AiPocBackendPreference,
  AiPocResponse,
} from "../ai-poc/types";

export const KATA9X9_MANIFEST =
  "/static/models/kata9x9-b18c384nbt-20231025/manifest.json";

let worker: Worker | undefined;

export async function analyzePositionDirect(
  position: AiPocPosition,
  options: {
    backendPreference?: AiPocBackendPreference;
    policyOptimism?: number;
  } = {},
): Promise<AiAnalyzePositionResult> {
  if (position.boardSize !== 9) {
    throw new Error("Direct AI analysis currently requires a 9x9 position");
  }

  const id = crypto.randomUUID();
  const activeWorker = ensureAiWorker();

  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<AiPocResponse>) => {
      const response = event.data;

      if (response.id !== id) {
        return;
      }

      activeWorker.removeEventListener("message", onMessage);

      if (response.type === "error") {
        reject(new Error(response.message));
        return;
      }

      if (!("analysis" in response.result)) {
        reject(new Error("AI worker returned a non-analysis result"));
        return;
      }

      resolve(response.result);
    };

    activeWorker.addEventListener("message", onMessage);
    activeWorker.postMessage({
      id,
      type: "analyze-position",
      manifestUrl: KATA9X9_MANIFEST,
      backendPreference: options.backendPreference ?? "auto",
      policyOptimism: options.policyOptimism ?? 0,
      position,
      preset: "direct",
    });
  });
}

function ensureAiWorker(): Worker {
  if (!worker) {
    worker = new Worker("/static/dist/ai-poc-worker.js", { type: "module" });
  }

  return worker;
}
