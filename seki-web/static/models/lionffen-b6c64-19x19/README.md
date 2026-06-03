# Lionffen B6C64 Official KataGo ONNX PoC Model

This is a small official KataGo network exported through KataGo's own
`OnnxModelBuilder`. The `.onnx` artifact is ignored by git. Generate it locally
before running `/static/ai-poc.html` with this manifest:

```bash
tools/export-lionffen-b6c64-19x19.sh
```

The exported model uses official KataGo ONNX IO:

- Inputs: `InputMask`, `InputSpatial`, `InputGlobal`
- Outputs: `OutputPolicyPass`, `OutputPolicy`, `OutputValue`,
  `OutputScoreValue`, `OutputOwnership`

The frontend PoC maps those names to semantic `policy`, `policyPass`, `value`,
`scoreValue`, and `ownership` output rows.
