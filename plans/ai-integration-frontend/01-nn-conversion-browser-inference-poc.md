# 01 — NN Conversion and Browser Inference PoC

## Goal

Prove that one small KataGo-derived model can be converted into browser-native
artifacts and run policy/value/ownership inference in a Web Worker on the target
mobile device.

Do not build bot UI, MCTS, model cache UX, or production worker protocol in this
step. This is a feasibility gate. If this fails on conversion, unsupported ops,
artifact size, startup time, or mobile latency, stop and choose a different model
or runtime before continuing.

## Inputs

- One small model candidate chosen for mobile testing.
- One required Android/WebView target device.
- One desktop sanity browser, preferably current Chromium.
- Official TensorFlow.js conversion/loading docs:
  - https://www.tensorflow.org/js/guide/conversion
  - https://www.tensorflow.org/js/tutorials/conversion/import_saved_model
  - https://www.tensorflow.org/js/guide/platform_environment

## Conversion Approach

Do not parse raw KataGo `.bin.gz` files in the browser.

Create a local conversion path that emits browser artifacts:

1. Obtain the source model and record source URL, checksum, network size, and
   license/provenance in the generated manifest.
2. Convert through the simplest reliable intermediate supported by TF.js tooling
   for the selected model, such as TensorFlow SavedModel or another documented
   input format.
3. Emit `model.json` plus weight shards.
4. Add a small `manifest.json` beside the model artifacts.
5. Keep generated model artifacts out of app source modules; serve them as static
   files from `seki-web/static/models/<model-id>/`.

If conversion requires a separate script, place it outside runtime code, for
example under a frontend scripts or tooling area. The script may depend on
conversion tooling that is not shipped to browsers.

## Manifest Shape

Use a compact manifest with enough data for the PoC and future cache work:

```json
{
  "id": "katago-small-v1",
  "source": {
    "name": "KataGo small model",
    "url": "https://...",
    "sha256": "..."
  },
  "artifacts": {
    "model": "/static/models/katago-small-v1/model.json",
    "weights": ["/static/models/katago-small-v1/group1-shard1ofN.bin"]
  },
  "boardSizes": [9, 13, 19],
  "outputs": ["policy", "value", "ownership"],
  "version": 1
}
```

Keep strength presets out of this PoC unless model-specific limits are already
known. Add them in the runtime/cache plan after benchmarks exist.

## Browser Harness

Build the smallest non-product harness that proves worker inference:

- A dedicated Web Worker imports TF.js and the needed backend packages.
- The worker loads the manifest and `model.json`.
- The worker explicitly tries backend selection in this order:
  1. WebGPU when available and stable.
  2. WASM/XNNPACK with SIMD/threads when supported.
  3. CPU only as a last-resort measurement.
- The worker warms the model with one fixed empty-board or simple-position input.
- The worker runs repeated fixed-position inference and returns metrics.

The harness can be a temporary development route, a standalone static page, or a
script-driven browser test. Keep it isolated so it can be removed or converted
into production worker code later.

## Metrics to Capture

Capture the same metrics on desktop and target Android/WebView:

- Browser/device label.
- Backend selected.
- Model artifact bytes over network.
- Model bytes stored locally.
- Worker startup time.
- Model load time.
- Warmup time.
- Single eval p50 and p95 over at least 30 repeated runs.
- Memory estimate if available from the browser/runtime.
- Output tensor names/shapes for policy, value, and ownership.

Store results in this plan file or a sibling notes file before moving on.

## Acceptance Criteria

Proceed only if all are true:

- Conversion emits loadable browser artifacts without unsupported runtime ops.
- Worker loads the model and runs inference on desktop and target Android/WebView.
- Outputs include policy, value, and ownership or a documented equivalent mapping.
- p95 mobile eval latency is low enough to make small-batch MCTS plausible.
- Model artifact and stored bytes fit the mobile storage budget.
- Backend fallback behavior is known for the target Android/WebView device.

## Stop Conditions

Stop and revise the AI approach if:

- Conversion requires maintaining a browser KataGo weight parser.
- TF.js cannot execute required ops for the selected model.
- The target mobile device falls back to CPU with unusable eval latency.
- Artifact size makes first download or offline storage unreasonable.
- Output semantics cannot be mapped confidently to policy/value/ownership.

## Deliverables

- Conversion notes and exact command sequence.
- Static model artifact directory for the PoC model, if artifacts are committed.
- `manifest.json` for the PoC model.
- Worker inference harness.
- Desktop and Android/WebView benchmark results.
- Recommendation: proceed with this model/runtime, pick another model, or change
  runtime strategy.

## Implementation Notes

- Initial harness path: `/static/ai-poc.html`.
- Initial worker bundle: `/static/dist/ai-poc-worker.js`.
- Synthetic manifest: `/static/models/ai-poc-synthetic/manifest.json`.
- Real-model manifest: `/static/models/kaya-b28c512-uint8/manifest.json`.
- The synthetic manifest exercises TensorFlow.js backend selection and tensor
  output reporting before a real converted model exists.
- The real-model path uses ONNX Runtime Web and the already-converted Kaya
  UINT8 ONNX artifact. Download it locally with the command in
  `/static/models/kaya-b28c512-uint8/README.md`; the `.onnx` file is ignored by
  git because it is about 75 MB.
- The current real-model smoke test feeds a partial KataGo v7 input encoding for
  empty/simple 19x19 positions. It is still not production-ready: ladder,
  scoring area, superko, encore, and exact Seki engine snapshots remain part of
  the AI core plan.
- The harness can export benchmark JSON from desktop or Android runs. Keep these
  measurements in this plan until a dedicated benchmark notes file is warranted.
- Keep the PoC isolated from product UI until real model output and mobile
  benchmark data are captured.

## Benchmark Notes

### Chrome Android WebGPU — Kaya B28C512 UINT8 ONNX

- Date captured: 2026-06-01.
- Browser/device label: Chrome Android user agent
  `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36`.
- Runtime/backend: ONNX Runtime Web, WebGPU.
- WebGPU status: available.
- Model: `kaya-b28c512-uint8`.
- Artifact bytes: 75,176,902.
- Board/input: 19x19 empty board, `katago-v7-poc-subset`, black to move,
  komi 6.5.
- Runs: 3.
- Model load: 4,092.5 ms.
- Warmup: 7,086.8 ms.
- Eval p50/p95: 7,004.2 ms / 7,028.3 ms.
- Output sanity:
  - Policy/value/ownership tensors present.
  - Value softmax roughly win 57.7%, loss 42.3%, no-result ~0.0016%.
  - Top policy moves are star-point/opening-like (`Q16`, `D4`, `Q4`, `D16`).

Recommendation from this benchmark: do not proceed to mobile MCTS with this
large 19x19 B28C512 model. It proves ONNX WebGPU execution works on the target
browser, but single-eval latency is far too high for search. Use it only as a
correctness/protocol PoC while selecting or exporting a much smaller model.

## Smaller Model Candidate Notes

The ready-made Kaya ONNX repository currently gives us convenient browser
artifacts, but only for large B28C512 KataGo models. Smaller public KataGo nets
exist, but they are native KataGo weight files or raw training checkpoints, so
the next risk moves back to conversion.

Candidate order:

1. `lionffen-b6c64-19x19`
   - Source:
     `https://media.katagotraining.org/uploaded/networks/models_extra/lionffen_b6c64_3x3_v10.txt.gz`
   - Download size: 2,196,103 bytes.
   - Board size: 19x19-specific.
   - Why first: tiny 6-block, 64-channel net. Best chance to make mobile
     single-eval latency plausible.
   - Risk: native KataGo `.txt.gz`, not ONNX and not a raw PyTorch checkpoint.
     The existing `kaya-go/katago-onnx` converter targets PyTorch checkpoints,
     so this requires either finding a raw checkpoint for this net or adding an
     offline native-weight conversion path.

2. `lionffen-b24c64-19x19`
   - Source:
     `https://media.katagotraining.org/uploaded/networks/models_extra/lionffen_b24c64_3x3_v3_12300.bin.gz`
   - Download size: 4,842,138 bytes.
   - Board size: 19x19-oriented.
   - Why second: still small, likely stronger than the 6-block net.
   - Risk: more compute than B6C64 and still native KataGo format.

3. `kata9x9-b18c384nbt-20231025`
   - Source:
     `https://media.katagotraining.org/uploaded/networks/models_extra/kata9x9-b18c384nbt-20231025.bin.gz`
   - Download size: 97,878,277 bytes.
   - Board size: 9x9 only.
   - Why keep: strong dedicated 9x9 candidate and useful if first product scope
     targets 9x9.
   - Risk: too large as a download, not useful for 13x13 or 19x19, and still
     needs conversion.

Recommendation: pursue `lionffen-b6c64-19x19` first, but treat conversion as the
gate. First try to locate or request a raw checkpoint for this net. If none is
available, decide whether an offline native KataGo-weight converter is worth the
work. Fall back to the 9x9 raw checkpoint path only if the product decision is
to ship 9x9 AI before 19x19 AI. Keep `kaya-b28c512-uint8` only as the known-good
ONNX runtime fixture.
