# Lionffen B6C64 Official KataGo ONNX PoC Model

This is a small official KataGo network exported through KataGo's own
`OnnxModelBuilder`. The `.onnx` artifact is ignored by git. Generate it locally
before running `/static/ai-poc.html` with this manifest:

```bash
curl -L -o /tmp/lionffen_b6c64_3x3_v10.txt.gz https://media.katagotraining.org/uploaded/networks/models_extra/lionffen_b6c64_3x3_v10.txt.gz
LD_LIBRARY_PATH=/home/linuxbrew/.linuxbrew/lib /tmp/katago-export-onnx /tmp/lionffen_b6c64_3x3_v10.txt.gz seki-web/static/models/lionffen-b6c64-19x19/lionffen-b6c64-19x19.onnx 19 true false
```

The exported model uses official KataGo ONNX IO:

- Inputs: `InputMask`, `InputSpatial`, `InputGlobal`
- Outputs: `OutputPolicyPass`, `OutputPolicy`, `OutputValue`,
  `OutputScoreValue`, `OutputOwnership`

The frontend PoC maps those names to semantic `policy`, `policyPass`, `value`,
`scoreValue`, and `ownership` output rows.
