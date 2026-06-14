import { signal } from "@preact/signals";
import type { AiPocManifest } from "../ai-poc/types";

export type AiModelDownloadContext = "bot" | "analysis";

export type AiModelDownloadPrompt = {
  manifest: AiPocManifest;
  sizeLabel: string;
  phase: "prompt" | "downloading";
  progress?: number;
  onDownload: () => void;
  onCancel: () => void;
};

type AvailabilityOptions = {
  manifestUrl: string;
  context: AiModelDownloadContext;
};

type DownloadPromptResult = "downloaded" | "cancelled" | "failed";

const MODEL_CACHE_NAME = "seki-ai-models-v1";
const DECLINED_KEY = "seki:ai:model-download-declined";

export const aiModelDownloadPrompt = signal<AiModelDownloadPrompt | undefined>(
  undefined,
);

let activeRequest:
  | {
      resolve: (result: DownloadPromptResult) => void;
      abortController?: AbortController;
    }
  | undefined;

export async function ensureAiModelAvailable(
  options: AvailabilityOptions,
): Promise<boolean> {
  const manifest = await fetchAiManifest(options.manifestUrl);
  const modelUrl = manifest.artifacts?.model;

  if (!modelUrl) {
    return true;
  }

  if (await isModelCached(modelUrl)) {
    return true;
  }

  if (options.context !== "bot" && sessionStorage.getItem(DECLINED_KEY)) {
    return false;
  }

  const result = await promptForModelDownload(manifest, options.context);

  if (result === "cancelled" && options.context !== "bot") {
    sessionStorage.setItem(DECLINED_KEY, "1");
  }

  return result === "downloaded";
}

export async function fetchAiManifest(url: string): Promise<AiPocManifest> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Manifest fetch failed: ${response.status} ${response.statusText}`,
    );
  }

  return (await response.json()) as AiPocManifest;
}

export function formatModelSize(bytes: number | undefined): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) {
    return "large";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  const precision = value >= 10 || unit === 0 ? 0 : 1;

  return `${value.toFixed(precision)} ${units[unit]}`;
}

async function promptForModelDownload(
  manifest: AiPocManifest,
  context: AiModelDownloadContext,
): Promise<DownloadPromptResult> {
  activeRequest?.abortController?.abort();
  activeRequest?.resolve("failed");

  return new Promise((resolve) => {
    activeRequest = { resolve };
    showPrompt(manifest, context);
  });
}

function showPrompt(manifest: AiPocManifest, context: AiModelDownloadContext) {
  aiModelDownloadPrompt.value = {
    manifest,
    sizeLabel: formatModelSize(manifest.artifactBytes),
    phase: "prompt",
    onDownload: () => {
      void startDownload(manifest, context);
    },
    onCancel: () => finishPrompt("cancelled"),
  };
}

async function startDownload(
  manifest: AiPocManifest,
  context: AiModelDownloadContext,
) {
  const request = activeRequest;
  const modelUrl = manifest.artifacts?.model;

  if (!request || !modelUrl) {
    finishPrompt("downloaded");

    return;
  }

  const abortController = new AbortController();
  request.abortController = abortController;
  updateDownloadPrompt(manifest, 0, () => {
    abortController.abort();
    showPrompt(manifest, context);
  });

  try {
    await downloadModelToCache(modelUrl, manifest.artifactBytes, {
      signal: abortController.signal,
      onProgress: (progress) => {
        if (activeRequest === request) {
          updateDownloadPrompt(manifest, progress, () => {
            abortController.abort();
            showPrompt(manifest, context);
          });
        }
      },
    });

    if (activeRequest === request) {
      finishPrompt("downloaded");
    }
  } catch (err) {
    if (abortController.signal.aborted) {
      return;
    }

    finishPrompt("failed");
    console.error(err);
  }
}

function updateDownloadPrompt(
  manifest: AiPocManifest,
  progress: number | undefined,
  onCancel: () => void,
) {
  aiModelDownloadPrompt.value = {
    manifest,
    sizeLabel: formatModelSize(manifest.artifactBytes),
    phase: "downloading",
    progress,
    onDownload: () => {},
    onCancel,
  };
}

function finishPrompt(result: DownloadPromptResult) {
  const request = activeRequest;

  activeRequest = undefined;
  aiModelDownloadPrompt.value = undefined;
  request?.resolve(result);
}

async function isModelCached(url: string): Promise<boolean> {
  if (!("caches" in window)) {
    return false;
  }

  const cache = await caches.open(MODEL_CACHE_NAME);
  const request = modelRequest(url);

  return (await cache.match(request)) != null;
}

async function downloadModelToCache(
  url: string,
  expectedBytes: number | undefined,
  options: {
    signal: AbortSignal;
    onProgress: (progress: number | undefined) => void;
  },
) {
  if (!("caches" in window)) {
    await fetch(url, { signal: options.signal, cache: "reload" });

    return;
  }

  const response = await fetch(url, {
    signal: options.signal,
    cache: "reload",
  });

  if (!response.ok) {
    throw new Error(`Model download failed: ${response.status}`);
  }

  const contentLength = response.headers.get("content-length");
  const parsedLength = contentLength ? Number(contentLength) : undefined;
  const total =
    expectedBytes ??
    (parsedLength && Number.isFinite(parsedLength) ? parsedLength : undefined);
  const reader = response.body?.getReader();

  if (!reader) {
    const cache = await caches.open(MODEL_CACHE_NAME);
    await cache.put(modelRequest(url), response.clone());

    return;
  }

  const chunks: ArrayBuffer[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    const chunk = new Uint8Array(value.byteLength);
    chunk.set(value);
    chunks.push(chunk.buffer);
    loaded += value.byteLength;
    options.onProgress(total ? Math.min(1, loaded / total) : undefined);
  }

  const headers = new Headers(response.headers);
  const blob = new Blob(chunks, {
    type: headers.get("content-type") ?? "application/octet-stream",
  });
  const cached = new Response(blob, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  const cache = await caches.open(MODEL_CACHE_NAME);

  await cache.put(modelRequest(url), cached);
}

function modelRequest(url: string): Request {
  return new Request(new URL(url, window.location.origin).href, {
    method: "GET",
  });
}
