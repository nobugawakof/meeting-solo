# 🎙️ Meeting Solo

**Live captions & a copyable, persistent transcript for interviews and meetings.**

Meeting Solo listens to your microphone and turns speech into text in real time —
big, readable captions on screen plus a full transcript you can copy, export, and
keep. It supports **English** and **Chinese** (Mandarin, Taiwan, and Cantonese),
with **live English ⇄ Chinese translation** and **speaker labels**.

It's built to fix the three frustrating limits of Windows 11 Live Captions:

| Live Captions | Meeting Solo |
| --- | --- |
| Only a few lines of text are shown | **Unlimited transcript** — nothing is dropped |
| You can't copy the captions | **Copy** to clipboard or **Export** to a `.txt` file |
| Everything vanishes when you turn it off | **Auto-saved** in your browser — it's still there next time |

## Features

- **Real-time captions** — a large live caption bar shows words as you speak.
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

Meeting Solo uses the browser's built-in **Web Speech API**.

- ✅ **Google Chrome** (desktop, Android)
- ✅ **Microsoft Edge** (desktop)
- ⚠️ **Safari / Firefox** — limited or no support; the app shows a notice.

## Privacy

Meeting Solo has **no backend of its own** and stores your transcript only in your
browser (localStorage). Two features do rely on online services, though:

- **Speech recognition** — the Web Speech API in Chrome/Edge sends microphone audio
  to the browser vendor's speech service to turn it into text. This is how the
  browser's speech recognition works everywhere.
- **Translation (only when the Translate toggle is on)** — each finalized line of
  text is sent to a public translation service (Google Translate's free endpoint,
  with MyMemory as a fallback) and the translation is sent back. With translation
  **off**, no transcript text leaves your browser through this app.

If you need everything to stay fully on-device, that requires an offline model
(e.g. Whisper) — see the roadmap below.

## Project structure

```
index.html   — markup & layout
styles.css   — theme-aware styling (light/dark)
app.js       — recognition, transcript, persistence, export
```

## Roadmap ideas

- Automatic speaker separation (diarization) from the audio
- Multi-language auto-switching within one session
- Export to Markdown, `.srt`, and `.vtt`
- Optional on-device model (Whisper) for full offline privacy & Safari/Firefox support
- Show the translation live in the caption bar as you speak

## License

MIT — see [`LICENSE`](LICENSE).
