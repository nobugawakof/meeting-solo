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

> **Why isn't the model bundled into the app?** It's ~40 MB — bundling it would slow
> down *every* startup, including for people who only use the live microphone. Instead
> it's fetched lazily the first time you transcribe a file, then cached by the browser,
> which keeps the app itself instant to open.

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
index.html   — markup & layout
styles.css   — theme-aware styling (light/dark)
app.js       — live recognition, transcript, translation, export, UI
worker.js    — background thread that runs Whisper for file transcription
```

## Roadmap ideas

- Automatic speaker separation (diarization) from the audio
- Sync the file transcript with a video player (click a line to jump to that moment)
- Larger Whisper model option for higher accuracy on tough audio
- Export to Markdown, `.srt`, and `.vtt`
- Show the translation live in the caption bar as you speak

## License

MIT — see [`LICENSE`](LICENSE).
