# KataGo ONNX Export Tool

`tools/katago-export-onnx.cpp` is a small standalone wrapper around the
vendored KataGo `OnnxModelBuilder`. It converts KataGo `.bin.gz` or `.txt.gz`
networks into fixed-board ONNX models for the browser inference PoC.

Build after copying KataGo source to `vendor/KataGo`:

```bash
rm -rf /tmp/katago-onnx-build
mkdir -p /tmp/katago-onnx-build
/home/linuxbrew/.linuxbrew/bin/protoc \
  --cpp_out=/tmp/katago-onnx-build \
  --proto_path=vendor/KataGo/cpp/external/onnx \
  vendor/KataGo/cpp/external/onnx/onnx.proto

g++ -std=c++17 -O2 -ffunction-sections -fdata-sections \
  -Ivendor/KataGo/cpp \
  -Ivendor/KataGo/cpp/external/filesystem-1.5.8/include \
  -I/tmp/katago-onnx-build \
  tools/katago-export-onnx.cpp \
  vendor/KataGo/cpp/neuralnet/onnxmodelbuilder.cpp \
  vendor/KataGo/cpp/neuralnet/desc.cpp \
  vendor/KataGo/cpp/neuralnet/modelversion.cpp \
  vendor/KataGo/cpp/game/rules.cpp \
  vendor/KataGo/cpp/core/global.cpp \
  vendor/KataGo/cpp/core/fileutils.cpp \
  vendor/KataGo/cpp/core/sha2.cpp \
  vendor/KataGo/cpp/core/md5.cpp \
  vendor/KataGo/cpp/core/datetime.cpp \
  /tmp/katago-onnx-build/onnx.pb.cc \
  $(PKG_CONFIG_PATH=/home/linuxbrew/.linuxbrew/lib/pkgconfig pkg-config --libs --cflags protobuf) \
  -lz -pthread -Wl,--gc-sections \
  -o /tmp/katago-export-onnx
```

Export a 19x19 model:

```bash
LD_LIBRARY_PATH=/home/linuxbrew/.linuxbrew/lib /tmp/katago-export-onnx input.txt.gz output.onnx 19 true false
```
