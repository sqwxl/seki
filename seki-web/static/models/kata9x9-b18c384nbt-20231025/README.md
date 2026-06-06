# Kata9x9 B18C384NBT Official KataGo ONNX PoC Model

This is a dedicated 9x9 KataGo network exported through KataGo's own
`OnnxModelBuilder`. The `.onnx` artifact is ignored by git. Generate it locally
before running `/static/ai-poc.html` with this manifest:

```bash
tools/export-kata9x9-b18c384nbt-20231025.sh
```

Observed local export:

- Source artifact: `kata9x9-b18c384nbt-20231025.bin.gz`
- ONNX artifact size: 105,526,431 bytes
- KataGo internal model: `kata9x9-b18c384nbt-s6603587840-d252232394`
- Parameters: 26,326,985

The exported model uses official KataGo ONNX IO:

- Inputs: `InputMask`, `InputSpatial`, `InputGlobal`
- Outputs: `OutputPolicyPass`, `OutputPolicy`, `OutputValue`,
  `OutputScoreValue`, `OutputOwnership`

Use this as a 9x9 lab model first. It is much larger than the current
`lionffen-b6c64-19x19` PoC model, so Android load/eval latency must be measured
before treating it as product-viable.
