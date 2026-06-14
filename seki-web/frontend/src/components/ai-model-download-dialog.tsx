import { aiModelDownloadPrompt } from "../ai/model-download";
import { ConfirmModal } from "./controls-shared";
import { IconSpinner } from "./icons";

export function AiModelDownloadDialog() {
  const prompt = aiModelDownloadPrompt.value;

  if (!prompt) {
    return null;
  }

  return (
    <ConfirmModal open dismissible={false}>
      <div class="confirm-popover ai-model-download-dialog">
        {prompt.phase === "prompt" ? (
          <>
            <strong>Heads up!</strong>
            <p>
              This feature requires a {prompt.sizeLabel} model to be downloaded.
            </p>
            <div class="confirm-actions">
              <button class="btn btn-success" onClick={prompt.onDownload}>
                Download
              </button>
              <button class="btn btn-warn" onClick={prompt.onCancel}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <p>Downloading {prompt.manifest.id}</p>
            <IconSpinner />
            <button class="btn btn-warn" onClick={prompt.onCancel}>
              Cancel
            </button>
            <progress
              value={prompt.progress}
              max="1"
              aria-label="Model download progress"
            />
          </>
        )}
      </div>
    </ConfirmModal>
  );
}
