# Local Whisper model

Meeting Solo transcribes recorded files with **Whisper**, run locally in your
browser. This folder is where the model weights live so everything works
**offline** — with no runtime download and no dependency on any external host.

## Populate it (one command)

From the project root:

```bash
bash scripts/fetch-model.sh
```

This downloads the default **`Xenova/whisper-small`** (the app's **High** accuracy
setting) into `models/Xenova/whisper-small/`. By default it pulls from
**hf-mirror.com**, a HuggingFace mirror reachable worldwide (including mainland
China). To use the HuggingFace origin instead:

```bash
HF_ENDPOINT=https://huggingface.co bash scripts/fetch-model.sh
```

A different size:

```bash
MODEL=Xenova/whisper-base   bash scripts/fetch-model.sh   # the app's "Fast" setting
MODEL=Xenova/whisper-medium bash scripts/fetch-model.sh   # even more accurate, large & slow
```

## What gets created

```
models/Xenova/whisper-small/
  config.json
  tokenizer.json
  tokenizer_config.json
  preprocessor_config.json
  generation_config.json
  onnx/encoder_model_quantized.onnx
  onnx/decoder_model_merged_quantized.onnx
```

## If this folder is empty

The app still works: it falls back to fetching the model once from the mirror
configured in `worker.js` (`MODEL_HOST`), then the browser caches it. Running
the script above is only needed for a fully self-contained, offline setup.

> The weight files (`*.onnx`) are large and are **git-ignored** by default — see
> `.gitignore`. Run the script on each machine, or remove the ignore rule if you
> want to commit them into your own fork.
