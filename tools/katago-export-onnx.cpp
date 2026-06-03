#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>

#include "core/fileutils.h"
#include "core/global.h"
#include "neuralnet/desc.h"
#include "neuralnet/onnxmodelbuilder.h"

void Logger::write(const std::string&) {}

namespace {

int parse_positive_int(const char* raw, const std::string& name) {
  int value = Global::stringToInt(raw);
  if(value <= 0) {
    throw StringError(name + " must be positive");
  }
  return value;
}

bool parse_bool_arg(const char* raw, const std::string& name) {
  std::string value = Global::toLower(raw);
  if(value == "true" || value == "1") {
    return true;
  }
  if(value == "false" || value == "0") {
    return false;
  }
  throw StringError(name + " must be true/false or 1/0");
}

void usage(const char* argv0) {
  std::cerr
      << "Usage: " << argv0
      << " <model.bin.gz|model.txt.gz> <out.onnx> <board_size> [require_exact=true] [transformer_nhwc=false]\n";
}

}  // namespace

int main(int argc, char** argv) {
  if(argc < 4 || argc > 6) {
    usage(argv[0]);
    return 2;
  }

  try {
    std::string model_path = argv[1];
    std::string out_path = argv[2];
    int board_size = parse_positive_int(argv[3], "board_size");
    bool require_exact = argc >= 5 ? parse_bool_arg(argv[4], "require_exact") : true;
    bool transformer_nhwc = argc >= 6 ? parse_bool_arg(argv[5], "transformer_nhwc") : false;

    ModelDesc desc;
    ModelDesc::loadFromFileMaybeGZipped(model_path, desc, "");
    desc.applyScale8ToReduceActivations();

    OnnxModelBuilder::Result result = OnnxModelBuilder::build(
        desc,
        board_size,
        board_size,
        require_exact,
        transformer_nhwc,
        nullptr);

    std::ofstream out;
    FileUtils::open(out, out_path, std::ios::out | std::ios::binary);
    out.write(result.serializedModel.data(), static_cast<std::streamsize>(result.serializedModel.size()));
    out.close();
    if(out.fail()) {
      throw StringError("failed to write " + out_path);
    }

    std::cout << "Wrote " << out_path << " (" << result.serializedModel.size() << " bytes)\n";
    std::cout << "Model: " << desc.name << " (" << desc.getShortInfoString() << ")\n";
    std::cout << "Inputs: InputMask, InputSpatial, InputGlobal";
    if(desc.numInputMetaChannels > 0) {
      std::cout << ", InputMeta";
    }
    std::cout << "\n";
    std::cout << "Outputs: OutputPolicyPass, OutputPolicy, OutputValue, OutputScoreValue, OutputOwnership\n";
    return 0;
  }
  catch(const std::exception& e) {
    std::cerr << "katago-export-onnx: " << e.what() << "\n";
    return 1;
  }
}
