import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  aiModelDownloadPrompt,
  ensureAiModelAvailable,
  formatModelSize,
} from "../ai/model-download";

const manifest = {
  id: "test-model",
  version: 1,
  kind: "onnx",
  artifactBytes: 104857600,
  source: { name: "Test" },
  artifacts: { model: "/static/models/test/model.onnx" },
  boardSizes: [9],
  outputs: ["policy"],
};

describe("AI model download gate", () => {
  beforeEach(() => {
    sessionStorage.clear();
    aiModelDownloadPrompt.value = undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(manifest)),
    );
    vi.stubGlobal("caches", {
      open: vi.fn(async () => ({
        match: vi.fn(async () => undefined),
        put: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    aiModelDownloadPrompt.value = undefined;
  });

  it("formats model sizes for prompt copy", () => {
    expect(formatModelSize(105526431)).toBe("101 MB");
    expect(formatModelSize(undefined)).toBe("large");
  });

  it("stores declined prompt preference for analysis flows", async () => {
    const pending = ensureAiModelAvailable({
      manifestUrl: "/manifest.json",
      context: "analysis",
    });

    await waitUntilPrompt();
    aiModelDownloadPrompt.value!.onCancel();

    await expect(pending).resolves.toBe(false);
    expect(sessionStorage.getItem("seki:ai:model-download-declined")).toBe("1");

    await expect(
      ensureAiModelAvailable({
        manifestUrl: "/manifest.json",
        context: "analysis",
      }),
    ).resolves.toBe(false);
    expect(aiModelDownloadPrompt.value).toBeUndefined();
  });

  it("does not store or honor declined prompt preference for bot flows", async () => {
    sessionStorage.setItem("seki:ai:model-download-declined", "1");

    const pending = ensureAiModelAvailable({
      manifestUrl: "/manifest.json",
      context: "bot",
    });

    await waitUntilPrompt();

    expect(aiModelDownloadPrompt.value?.manifest.id).toBe("test-model");
    aiModelDownloadPrompt.value?.onCancel();

    await expect(pending).resolves.toBe(false);
    expect(sessionStorage.getItem("seki:ai:model-download-declined")).toBe("1");
  });
});

async function waitUntilPrompt() {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
    if (aiModelDownloadPrompt.value) {
      return;
    }
  }

  expect(aiModelDownloadPrompt.value).toBeDefined();
}
