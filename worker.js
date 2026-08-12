/* Meeting Solo — file-transcription worker
 *
 * Runs Whisper (via transformers.js) in a background thread so the main UI
 * never freezes while the model loads or audio is transcribed.
 *
 * Everything the runtime needs is served from THIS project (no CDN):
 *   - the transformers.js library and the ONNX-Runtime WASM live in ./vendor/
 *   - the Whisper model is loaded from ./models/ if present (fully offline)
 *
 * If the model isn't vendored locally, it's fetched once from a HuggingFace
 * mirror that is reachable worldwide (including mainland China) and then cached
 * by the browser. Configure the mirror with MODEL_HOST below.
 *
 * Messages IN:  { type: "transcribe", audio: Float32Array, language: string, model: string }
 * Messages OUT: { type: "progress", data }   // model download / load progress
 *               { type: "ready" }             // model loaded, transcription starting
 *               { type: "result", result }    // { text, chunks: [{ timestamp, text }] }
 *               { type: "error", message }
 */

import { pipeline, env } from "./vendor/transformers/transformers.min.js";

// --- Where model weights come from if they aren't vendored in ./models/ -------
// hf-mirror.com mirrors huggingface.co and is reachable in regions where
// huggingface.co is blocked/slow (e.g. mainland China). Swap for
// "https://huggingface.co" if you prefer the origin.
const MODEL_HOST = "https://hf-mirror.com";
const DEFAULT_MODEL = "Xenova/whisper-small";

// Serve the ONNX-Runtime WASM from this project instead of a CDN.
env.backends.onnx.wasm.wasmPaths = new URL("./vendor/transformers/", self.location).href;
// A plain static server isn't cross-origin isolated, so run single-threaded.
env.backends.onnx.wasm.numThreads = 1;

// Try ./models/ first (fully offline); otherwise fall back to the mirror.
env.allowLocalModels = true;
env.localModelPath = new URL("./models/", self.location).href;
env.allowRemoteModels = true;
env.remoteHost = MODEL_HOST;

// One cached pipeline per model id (base / small), so switching accuracy is cheap.
const transcribers = {};
async function getTranscriber(modelId) {
  if (!transcribers[modelId]) {
    transcribers[modelId] = await pipeline("automatic-speech-recognition", modelId, {
      quantized: true,
      progress_callback: (p) => self.postMessage({ type: "progress", data: p }),
    });
  }
  return transcribers[modelId];
}

self.addEventListener("message", async (event) => {
  const msg = event.data || {};
  if (msg.type !== "transcribe") return;

  try {
    const transcriber = await getTranscriber(msg.model || DEFAULT_MODEL);
    self.postMessage({ type: "ready" });

    const result = await transcriber(msg.audio, {
      language: msg.language,
      task: "transcribe",
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
    });

    self.postMessage({ type: "result", result });
  } catch (err) {
    self.postMessage({ type: "error", message: String((err && err.message) || err) });
  }
});
