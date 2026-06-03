# KataGo ONNX Export Tool

`tools/katago-export-onnx.cpp` is a small standalone wrapper around the
vendored KataGo `OnnxModelBuilder`. It converts KataGo `.bin.gz` or `.txt.gz`
networks into fixed-board ONNX models for the browser inference PoC.

Build after copying KataGo source to `vendor/KataGo`:

```bash
tools/build-katago-export-onnx.sh
```

Export a 19x19 model:

```bash
LD_LIBRARY_PATH=/home/linuxbrew/.linuxbrew/lib /tmp/katago-export-onnx input.txt.gz output.onnx 19 true false
```

Export the current small PoC model into its ignored static artifact path:

```bash
tools/export-lionffen-b6c64-19x19.sh
```
