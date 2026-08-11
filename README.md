# 🎙️ Meeting Solo

**Live captions & a copyable, persistent transcript for interviews and meetings.**

Meeting Solo turns speech into text in real time — big, readable captions on screen
plus a full transcript you can copy, export, and keep. It works two ways: **live from
your microphone**, or by **transcribing a recorded audio/video file** (no microphone
needed). It supports **English** and **Chinese** (Mandarin, Taiwan, and Cantonese),
with **English ⇄ Chinese translation** and **speaker labels**.

It's built to fix the three frustrating limits of Windows 11 Live Captions:

| Live Captions | Meeting Solo |
| --- | --- |
| Only a few lines of text are shown | **Unlimited transcript** — nothing is dropped |
| You can't copy the captions | **Copy** to clipboard or **Export** to a `.txt` file |
| Everything vanishes when you turn it off | **Auto-saved** in your browser — it's still there next time |

## Features

- **Real-time captions** — a large live caption bar shows words as you speak.
- **Transcribe recorded files** — click **📁 File** to caption an existing audio or
  video recording (mp3, wav, m4a, mp4, webm…). Runs entirely in your browser — the
  file is never uploaded. No microphone required.
- **Capture system audio (desktop app)** — run Meeting Solo as a desktop app and
  click **🔊 System audio** to transcribe sound from **any program** — Telegram,
  Lark, Zoom, a browser tab — live, without a microphone.
- **Full scrollable transcript** — every finalized line is kept, with optional timestamps.
- **English & Chinese** — pick your language from the dropdown.
- **Live English ⇄ Chinese translation** — turn on **Translate ⇄** and each line is
  translated beneath the original; direction follows the language you're capturing.
- **Speaker labels** — tag who's talking with color-coded, renamable speaker chips
  (great for interviewer / candidate). Click a chip or press keys `1`–`9` to switch.
- **Copy & Export** — one click to copy everything or download a text file,
  including speaker names and translations.
- **Persistent** — the transcript is saved locally and restored automatically.
- **Word & line count** — including correct counting for Chinese characters.
- **Keyboard shortcut** — `Ctrl` / `⌘` + `Enter` to start or stop.
- **Light & dark mode** — follows your system theme.

## How to use

1. Open the app (see below).
2. Choose your **Language**.
3. (Optional) Turn on **Translate ⇄** for live English ⇄ Chinese translation.
4. (Optional) Set up **speakers** — rename the chips (double-click) and click one, or
   press `1`–`9`, to mark who's currently talking.
5. Click **Start** and allow microphone access when prompted.
6. Speak — captions appear live and finalized lines collect in the transcript.
7. Use **Copy**, **Export**, or **Clear** at any time.

### Transcribe a recorded file (no microphone)

Want to caption an interview you already recorded, or a meeting video?

1. Pick the **Language** of the recording.
2. Click **📁 File** and choose an audio or video file.
3. **The first time only**, a small speech-recognition model (**Whisper**, ~40 MB)
   downloads to your browser and is then **cached permanently** — every later
   transcription skips the download and starts immediately.
4. When it finishes, every segment drops into the transcript with its timecode.
   Turn on **Translate ⇄** to translate them, and use **Copy** / **Export** as usual.

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

### Translation & speaker labels — how they work

- **Translation** is applied per finalized line. The direction is automatic:
  English speech is translated to Chinese, Chinese speech to English. Turning the
  toggle on also translates any earlier lines that don't have a translation yet.
- **Speaker labels are manual.** True automatic speaker separation (diarization)
  needs voice fingerprinting the browser's speech API doesn't provide, so instead
  you tag the active speaker yourself — fast and reliable for interviews and
  1-on-1s. Every line records whichever speaker was active when it was finalized.

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

Then click **🔊 System audio**, and Meeting Solo transcribes whatever is playing
on your computer — a Telegram call, a Lark meeting, a video — into the transcript,
with the same translation, speaker labels, copy and export.

### Build an installer

```bash
npm run dist        # current OS
npm run dist:win    # Windows (.exe / NSIS)
```

### How it works & platform notes

- In the desktop app, live audio (both the **microphone** and **system audio**) is
  transcribed with **Whisper** — the same on-device engine as file mode — because
  the browser's Web Speech API isn't available in Electron. Audio is segmented on
  natural pauses and each segment is transcribed in the background worker.
- **Windows:** system-audio loopback capture is fully supported. ✅ (You're on
  Windows 11 — this is the target.)
- **macOS:** depends on the OS version (ScreenCaptureKit) and may require a
  loopback audio device (e.g. BlackHole).
- **Linux:** uses the PulseAudio monitor source.
- For the best desktop experience, vendor the model locally first
  (`bash scripts/fetch-model.sh`) so live transcription starts instantly and works
  fully offline.

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

- **📁 File transcription — fully on-device.** The Whisper model runs in your browser
  via WebAssembly; the audio/video file is decoded and transcribed locally and is
  **never uploaded**. (The one-time model download comes from a public CDN.)
- **Live microphone captions** — the Web Speech API in Chrome/Edge sends microphone
  audio to the browser vendor's speech service to turn it into text. This is how the
  browser's built-in speech recognition works everywhere.
- **Translation (only when the Translate toggle is on)** — each finalized line of
  text is sent to a public translation service (Google Translate's free endpoint,
  with MyMemory as a fallback) and the translation is sent back. With translation
  **off**, no transcript text leaves your browser through this app.

## Project structure

```
index.html              — markup & layout
styles.css              — theme-aware styling (light/dark)
app.js                  — live recognition, transcript, translation, export, UI
worker.js               — background thread that runs Whisper for file transcription
vendor/transformers/    — self-hosted transformers.js library + ONNX-Runtime WASM
models/                 — local Whisper weights (fetch with scripts/fetch-model.sh)
scripts/fetch-model.sh  — one-command model download (mirror-friendly)
electron/               — desktop app (main + preload) for system-audio capture
package.json            — Electron dependencies & build config
```

## Roadmap ideas

- Automatic speaker separation (diarization) from the audio
- Sync the file transcript with a video player (click a line to jump to that moment)
- Larger Whisper model option for higher accuracy on tough audio
- Export to Markdown, `.srt`, and `.vtt`
- Show the translation live in the caption bar as you speak

## License

MIT — see [`LICENSE`](LICENSE).
