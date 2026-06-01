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
- Keep the PoC isolated from product UI until real model output and mobile
  benchmark data are captured.
