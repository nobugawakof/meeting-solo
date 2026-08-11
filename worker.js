/* Meeting Solo — file-transcription worker
 *
 * Runs Whisper (via transformers.js) in a background thread so the main UI
 * never freezes while the model loads or audio is transcribed.
 *
 * Messages IN:  { type: "transcribe", audio: Float32Array, language: string }
 * Messages OUT: { type: "progress", data }   // model download / load progress
 *               { type: "ready" }             // model loaded, transcription starting
 *               { type: "result", result }    // { text, chunks: [{ timestamp, text }] }
 *               { type: "error", message }
 */

import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2";

// Don't look for a local /models/ folder — fetch straight from the CDN (cached
// by the browser after the first download).
try { env.allowLocalModels = false; } catch (_) {}

const MODEL = "Xenova/whisper-base";
let transcriber = null;

self.addEventListener("message", async (event) => {
  const msg = event.data || {};
  if (msg.type !== "transcribe") return;

  try {
    if (!transcriber) {
      transcriber = await pipeline("automatic-speech-recognition", MODEL, {
        quantized: true,
        progress_callback: (p) => self.postMessage({ type: "progress", data: p }),
      });
    }
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
