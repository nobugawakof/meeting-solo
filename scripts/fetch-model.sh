#!/usr/bin/env bash
#
# Download the Whisper speech model into ./models/ so Meeting Solo can transcribe
# files fully offline — no runtime download, no dependency on any CDN.
#
# Run once from the project root:
#     bash scripts/fetch-model.sh
#
# Defaults to a HuggingFace mirror that works worldwide (incl. mainland China).
# Override the source or model if you like:
#     HF_ENDPOINT=https://huggingface.co bash scripts/fetch-model.sh
#     MODEL=Xenova/whisper-small bash scripts/fetch-model.sh
#
set -euo pipefail

HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"
# whisper-small is the default (High accuracy). Use MODEL=Xenova/whisper-base for
# the Fast option, or a bigger model like Xenova/whisper-medium for best accuracy.
MODEL="${MODEL:-Xenova/whisper-small}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEST="$ROOT/models/$MODEL"

# Files transformers.js needs for an ASR pipeline (quantized ONNX weights).
FILES=(
  "config.json"
  "tokenizer.json"
  "tokenizer_config.json"
  "preprocessor_config.json"
  "generation_config.json"
  "onnx/encoder_model_quantized.onnx"
  "onnx/decoder_model_merged_quantized.onnx"
)

echo "Model:  $MODEL"
echo "Source: $HF_ENDPOINT"
echo "Into:   $DEST"
echo

for f in "${FILES[@]}"; do
  url="$HF_ENDPOINT/$MODEL/resolve/main/$f"
  out="$DEST/$f"
  mkdir -p "$(dirname "$out")"
  echo "↓ $f"
  # generation_config.json is optional for some models — don't fail the run.
  if ! curl -fSL --retry 3 -o "$out" "$url"; then
    if [ "$f" = "generation_config.json" ]; then
      echo "  (skipped — not published for this model)"
      rm -f "$out"
    else
      echo "  FAILED: $url" >&2
      exit 1
    fi
  fi
done

echo
echo "Done. Meeting Solo will now transcribe files fully offline from ./models/."
