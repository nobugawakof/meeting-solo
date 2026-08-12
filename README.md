# 🎙️ Meeting Solo

**Live captions & a copyable, persistent transcript for interviews and meetings.**

Meeting Solo turns speech into text in real time — big, readable captions on screen
plus a full transcript you can copy, export, and keep. It works two ways: **live from
your microphone**, or by **transcribing a recorded audio/video file** (no microphone
needed). It supports **English** and **Simplified Chinese**. One **Start** button
captures everything — your microphone *and* any app's audio (Meet, Lark, Telegram,
Zoom, a media player).

It's built to fix the three frustrating limits of Windows 11 Live Captions:

| Live Captions | Meeting Solo |
| --- | --- |
| Only a few lines of text are shown | **Unlimited transcript** — nothing is dropped |
| You can't copy the captions | **Copy** to clipboard or **Export** to a `.txt` file |
| Everything vanishes when you turn it off | **Auto-saved** in your browser — it's still there next time |

## Features

- **One-button capture** — **Start** captures everything at once: your microphone
  **and** your computer's audio, so it transcribes any meeting or media — Google
  Meet, Lark, Telegram, Zoom, a video player — with no setup. (System-audio capture
  needs the desktop app; in a browser, Start uses the microphone.)
- **Transcribe recorded files** — click **📁 File** to caption an existing audio or
  video recording (mp3, wav, m4a, mp4, webm…). Runs fully on-device — the file is
  never uploaded.
- **Live in the transcript** — words appear as you speak, right in the transcript;
  the still-being-spoken line shows dimmed until it finalizes.
- **Full scrollable transcript** — every finalized line is kept as its own line,
  with optional timestamps.
- **English & Simplified Chinese** — pick your language from the dropdown; the
  transcript stays in that language. (Chinese output is always converted to
  **Simplified** with OpenCC, since Whisper tends to emit Traditional.)
- **Accuracy setting (files)** — choose **High** (`whisper-small`, default — better,
  especially for Chinese) or **Fast** (`whisper-base`). **Live capture always uses
  the fast model** so it keeps up in real time. Both models are bundled in the
  installer, so nothing downloads at runtime.
- **Copy & Export** — one click to copy everything or download a text file.
- **Persistent** — the transcript is saved locally and restored automatically.
- **Word & line count** — including correct counting for Chinese characters.
- **Keyboard shortcut** — `Ctrl` / `⌘` + `Enter` to start or stop.
- **Light & dark mode** — follows your system theme.

## How to use

1. Open the app (see below).
2. Choose your **Language** (English or Simplified Chinese).
3. Click **Start**. In the desktop app this captures your mic *and* everything
   playing on your computer; in a browser it captures the microphone.
4. Words appear live in the transcript as they're recognized.
5. Use **Copy**, **Export**, or **Clear** at any time.

### Transcribe a recorded file

Want to caption an interview or meeting you already recorded?

1. Pick the **Language** of the recording.
2. Click **📁 File** and choose an audio or video file.
3. **The first time only**, a small speech-recognition model (**Whisper**, ~40 MB)
   downloads and is then **cached permanently** — every later transcription starts
   immediately.
4. When it finishes, every segment drops into the transcript with its timecode.
   Use **Copy** / **Export** as usual.

The model download and the transcription both run in a **background thread**
(a Web Worker), so the page stays responsive the whole time — no freezing — and
**Cancel** stops the work instantly. It all runs **100% in your browser** using
WebAssembly, so the file never leaves your device and it works in **any** modern
browser, including Safari and Firefox. Longer recordings take longer; expect a
fraction of real-time on a typical laptop.

### Self-hosted & offline — no CDN required

The transcription **runtime** (the `transformers.js` library and the ONNX-Runtime
WebAssembly) is **vendored into this project** under [`vendor/`](vendor/), so nothing
is fetched from a CDN like jsdelivr. Only the **model weights** need to come from
somewhere the first time:

- **By default**, they're fetched once from **[hf-mirror.com](https://hf-mirror.com)**
  — a HuggingFace mirror reachable worldwide, **including mainland China**, where
  `huggingface.co` is often blocked or slow — then cached by your browser. (Change
  the source with `MODEL_HOST` in [`worker.js`](worker.js).)
- **For a fully offline, self-contained setup**, vendor the model into the project too:

  ```bash
  bash scripts/fetch-model.sh
  ```

  This downloads the model into `models/Xenova/whisper-base/`. After that the app
  loads everything — library, runtime, and model — from this project with **no network
  at all**. See [`models/README.md`](models/README.md) for options.

> **Why isn't the model committed into the repo?** The weights are ~40 MB, so they're
> git-ignored by default to keep the repo light; `scripts/fetch-model.sh` fetches them
> on demand. The small runtime files *are* committed, so the app is CDN-independent out
> of the box. (Remove the `models/**` rule in `.gitignore` if you want to commit the
> weights into your own fork.)

### About the transcript

- **One line per utterance**, separated by line breaks — no speaker labels, no
  translation lines. The transcript stays in the language you selected, clean and
  fast.
- The **still-being-spoken** text shows as a dimmed line at the bottom and is
  replaced by the finalized line on a pause.

### Run it

It's a single static web app — no build step, no install.

**Option A — just open the file**

Open `index.html` in Google Chrome or Microsoft Edge.

> Speech recognition and the clipboard work best from `https://` or `localhost`.
> Opening the raw file works in most cases, but if the microphone is blocked,
> use Option B.

**Option B — serve locally** (recommended)

```bash
# from the project folder
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Desktop app (capture system audio from any program)

Browsers are sandboxed and can't listen to other apps. To transcribe audio from
**native apps like Telegram and Lark** live, run Meeting Solo as a desktop app
(Electron), which can capture your computer's **system (loopback) audio**.

### Run it

```bash
npm install      # installs Electron
npm start        # launches the desktop app
```

Then click **Start**, and Meeting Solo transcribes both your microphone and
whatever is playing on your computer — a Telegram call, a Lark meeting, a video —
into the transcript, with the same copy and export.

### Build an installer

```bash
npm run dist        # current OS
npm run dist:win    # Windows (.exe / NSIS)
```

Or **download a pre-built installer from CI**: every push to the app builds the
Windows installer via GitHub Actions
([`.github/workflows/build-desktop.yml`](.github/workflows/build-desktop.yml)) —
grab it from the run's **Artifacts**, or publish a GitHub Release to build it
for that release. **The CI installer bundles the Whisper model**, so it works
**fully offline** out of the box — no first-run download.

### Live transcription niceties

- **Live in the transcript** — while you speak, an evolving draft of the current
  line shows dimmed at the bottom of the transcript and finalizes on a pause.
- **Hallucination guard** — Whisper sometimes repeats a phrase on music or
  near-silence (e.g. "字幕: 字幕: …"); repeated runs are automatically collapsed.

### How it works & platform notes

- In the desktop app, **Start** captures the **microphone** and the **system
  (loopback) audio** together, mixes them, and transcribes with **Whisper** — the
  same on-device engine as file mode. (The browser's Web Speech API isn't available
  in Electron.) Audio is segmented on natural pauses and each segment is transcribed
  in the background worker. Tip: use headphones so your speakers' output isn't also
  picked up by the mic.
- **Windows:** system-audio loopback capture is fully supported. ✅ (You're on
  Windows 11 — this is the target.)
- **macOS:** depends on the OS version (ScreenCaptureKit) and may require a
  loopback audio device (e.g. BlackHole).
- **Linux:** uses the PulseAudio monitor source.
- For the best desktop experience, vendor the model locally first
  (`bash scripts/fetch-model.sh`) so live transcription starts instantly and works
  fully offline. (The CI-built installer already includes it.)
- **Speed:** the desktop app runs the ONNX Runtime on **multiple threads** (it
  serves itself cross-origin-isolated to unlock SharedArrayBuffer), which is what
  makes real-time capture keep up. Live capture uses `whisper-base`; larger models
  are reserved for file transcription.
- Internally the desktop app serves its own files over a private
  `http://127.0.0.1` origin, so microphone/system-audio capture, the clipboard,
  and the offline model all work the same as in a browser.

> **Note:** live streaming transcription trades a little latency for accuracy — a
> line appears a moment after each pause in speech, not word-by-word. This is the
> first version of desktop capture; expect it to improve.

## Browser support

Meeting Solo has two transcription engines:

| Engine | Used for | Browser support |
| --- | --- | --- |
| **Web Speech API** (built-in) | Live microphone captions | Chrome & Edge (desktop, Android) |
| **Whisper via `transformers.js`** (WebAssembly) | 📁 File transcription | Any modern browser, incl. Safari & Firefox |

So even where live captions aren't supported, **file transcription still works**.

## Privacy

Meeting Solo has **no backend of its own** and stores your transcript only in your
browser (localStorage). Here's where data goes for each feature:

- **Desktop app — fully on-device.** File transcription *and* live capture run
  Whisper locally via WebAssembly; audio is transcribed on your machine and is
  **never uploaded**. (With the CI installer, even the model is bundled — nothing
  leaves your device.)
- **Live microphone captions in a browser** — the Web Speech API in Chrome/Edge
  sends microphone audio to the browser vendor's speech service to turn it into
  text. This is how the browser's built-in speech recognition works everywhere.
  (The desktop app doesn't use this — it uses local Whisper instead.)

## Project structure

```
index.html              — markup & layout
styles.css              — theme-aware styling (light/dark)
app.js                  — capture, transcript, live preview, export, UI
worker.js               — background thread that runs Whisper
vendor/transformers/    — self-hosted transformers.js library + ONNX-Runtime WASM
vendor/opencc/          — Traditional→Simplified Chinese converter (OpenCC)
models/                 — local Whisper weights (fetch with scripts/fetch-model.sh)
scripts/fetch-model.sh  — one-command model download (mirror-friendly)
electron/               — desktop app (main + preload) for system-audio capture
package.json            — Electron dependencies & build config
```

## Roadmap ideas

- Sync the file transcript with a video player (click a line to jump to that moment)
- A "Best" accuracy tier (whisper-medium) for file transcription
- Export to Markdown, `.srt`, and `.vtt`
- Optional on-demand translation (kept off by default for speed)

## License

MIT — see [`LICENSE`](LICENSE).
