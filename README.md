# 🎙️ Meeting Solo

**Live captions & a copyable, persistent transcript for interviews and meetings.**

Meeting Solo listens to your microphone and turns speech into text in real time —
big, readable captions on screen plus a full transcript you can copy, export, and
keep. It supports **English** and **Chinese** (Mandarin, Taiwan, and Cantonese).

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
- **Copy & Export** — one click to copy everything or download a text file.
- **Persistent** — the transcript is saved locally and restored automatically.
- **Word & line count** — including correct counting for Chinese characters.
- **Private** — audio is processed by your browser; this app has no server and uploads nothing.
- **Keyboard shortcut** — `Ctrl` / `⌘` + `Enter` to start or stop.
- **Light & dark mode** — follows your system theme.

## How to use

1. Open the app (see below).
2. Choose your **Language**.
3. Click **Start** and allow microphone access when prompted.
4. Speak — captions appear live and finalized lines collect in the transcript.
5. Use **Copy**, **Export**, or **Clear** at any time.

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

The Web Speech API in Chrome/Edge sends audio to the browser vendor's speech
service to perform recognition — the same mechanism the browser uses everywhere.
Meeting Solo itself has no backend and stores your transcript only in your browser.

## Project structure

```
index.html   — markup & layout
styles.css   — theme-aware styling (light/dark)
app.js       — recognition, transcript, persistence, export
```

## Roadmap ideas

- Multi-language auto-switching within one session
- Speaker labels / diarization
- Export to Markdown, `.srt`, and `.vtt`
- Optional on-device model (Whisper) for full offline privacy
- Live translation between English and Chinese

## License

MIT — see [`LICENSE`](LICENSE).
