# Kaya B28C512 UINT8 ONNX PoC Model

Download the ONNX artifact locally before running `/static/ai-poc.html` with the
default manifest:

```bash
curl -L -o seki-web/static/models/kaya-b28c512-uint8/kaya-b28c512-uint8.onnx https://huggingface.co/kaya-go/kaya/resolve/main/kata1-b28c512nbt-adam-s11165M-d5387M/kata1-b28c512nbt-adam-s11165M-d5387M.uint8.onnx
```

The `.onnx` file is ignored by git because it is about 75 MB. This PoC only
tests browser model load and fixed dummy-input inference. Real board feature
planes are part of the later AI core work.

The manifest maps the ONNX outputs named `policy`, `value`, and `ownership` to
the semantic fields the rest of the frontend AI work will consume.

The current PoC uses a partial KataGo v7 input encoder based on KataGo's
`NNInputs::fillRowV7`. It covers on-board points, own/opponent stones,
liberty-count planes, simple ko, recent moves, komi, core rules, and komi parity.
It intentionally leaves advanced history/rules features at zero until the
production AI core is wired to Seki engine snapshots.
