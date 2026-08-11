/* Meeting Solo — Live Captions, Translation & Transcript
 *
 * Real-time speech-to-text using the browser's Web Speech API, with:
 *   - Unlimited transcript (every finalized line is kept)
 *   - Copy & export (clipboard / .txt download)
 *   - Persistence (auto-saved to localStorage)
 *   - Live English <-> Chinese translation (public translation services)
 *   - Manual speaker labels (color-coded, renamable)
 */

(function () {
  "use strict";

  const STORAGE_KEY = "meeting-solo.state.v2";
  const LEGACY_KEY = "meeting-solo.transcript.v1";
  const PREFS_KEY = "meeting-solo.prefs.v1";

  const SPEAKER_COLORS = [
    "#2563eb", "#db2777", "#16a34a", "#d97706",
    "#7c3aed", "#0891b2", "#dc2626", "#4b5563",
  ];
  const MAX_SPEAKERS = 9;

  // --- DOM references ---
  const el = {
    recordBtn: document.getElementById("recordBtn"),
    recordBtnLabel: document.getElementById("recordBtnLabel"),
    fileBtn: document.getElementById("fileBtn"),
    fileInput: document.getElementById("fileInput"),
    sysAudioBtn: document.getElementById("sysAudioBtn"),
    sysAudioLabel: document.getElementById("sysAudioLabel"),
    fileProgress: document.getElementById("fileProgress"),
    fpText: document.getElementById("fpText"),
    fpFill: document.getElementById("fpFill"),
    fpCancel: document.getElementById("fpCancel"),
    langSelect: document.getElementById("langSelect"),
    translateToggle: document.getElementById("translateToggle"),
    timestampToggle: document.getElementById("timestampToggle"),
    copyBtn: document.getElementById("copyBtn"),
    exportBtn: document.getElementById("exportBtn"),
    clearBtn: document.getElementById("clearBtn"),
    speakerChips: document.getElementById("speakerChips"),
    addSpeakerBtn: document.getElementById("addSpeakerBtn"),
    liveCaption: document.getElementById("liveCaption"),
    transcript: document.getElementById("transcript"),
    stats: document.getElementById("stats"),
    status: document.getElementById("status"),
    statusText: document.getElementById("statusText"),
    unsupported: document.getElementById("unsupported"),
    toast: document.getElementById("toast"),
  };

  // --- State ---
  /** @type {{time:string, text:string, speaker:string, lang:string, translation:?string, _node?:Element, _translating?:boolean, _failed?:boolean}[]} */
  let lines = [];
  let speakers = [
    { id: "s1", name: "Speaker 1", color: SPEAKER_COLORS[0] },
    { id: "s2", name: "Speaker 2", color: SPEAKER_COLORS[1] },
  ];
  let activeSpeakerId = "s1";
  let speakerSeq = 2;

  let recognition = null;
  let recording = false;
  let stoppedByUser = false;
  let restartTimer = null;

  // File transcription (in-browser Whisper, run in a Web Worker so the UI
  // never freezes while the model loads or audio is transcribed).
  let whisperWorker = null;
  let fileToken = 0; // bumped to cancel/ignore an in-flight job
  let processingFile = false;

  // Desktop (Electron) live streaming: capture mic or system audio, segment it
  // on silence, and transcribe each segment with Whisper in the worker.
  const IS_DESKTOP = !!(window.meetingSoloDesktop);
  const STREAM_SR = 16000;
  const SILENCE_RMS = 0.008;      // below this = "silence"
  const SILENCE_HOLD_MS = 700;    // silence this long ends a segment
  const MIN_SPEECH_MS = 700;      // need at least this much speech to flush
  const MAX_SEG_MS = 15000;       // hard cap so long talk still flushes
  const MIN_SEG_SAMPLES = STREAM_SR * 0.4;
  let streaming = false;
  let streamSource = "";          // "mic" | "system"
  let streamCtx = null, streamNode = null, streamSrcNode = null, streamGain = null;
  let mediaStream = null;
  let pcmBuf = [], pcmLen = 0, silentMs = 0, voicedMs = 0;
  let segQueue = [], segInFlight = false;

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------
  function loadState() {
    let loaded = null;
    try { loaded = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch (_) {}

    if (loaded && Array.isArray(loaded.speakers) && loaded.speakers.length) {
      lines = Array.isArray(loaded.lines) ? loaded.lines : [];
      speakers = loaded.speakers;
      activeSpeakerId = loaded.activeSpeakerId || speakers[0].id;
      speakerSeq = loaded.speakerSeq || speakers.length;
    } else {
      // Migrate legacy v1 (a plain array of {time, text}).
      try {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null");
        if (Array.isArray(legacy)) lines = legacy;
      } catch (_) {}
    }

    // Ensure every line has valid fields.
    for (const line of lines) {
      if (!line.speaker || !speakers.some((s) => s.id === line.speaker)) {
        line.speaker = speakers[0].id;
      }
      if (!line.lang) line.lang = "en-US";
      if (!("translation" in line)) line.translation = null;
    }
    if (!speakers.some((s) => s.id === activeSpeakerId)) activeSpeakerId = speakers[0].id;

    try {
      const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
      if (prefs.lang) el.langSelect.value = prefs.lang;
      if (typeof prefs.timestamps === "boolean") el.timestampToggle.checked = prefs.timestamps;
      if (typeof prefs.translate === "boolean") el.translateToggle.checked = prefs.translate;
    } catch (_) {}
  }

  function saveState() {
    try {
      const cleanLines = lines.map((l) => ({
        time: l.time, text: l.text, speaker: l.speaker,
        lang: l.lang, translation: l.translation || null,
      }));
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ lines: cleanLines, speakers, activeSpeakerId, speakerSeq })
      );
    } catch (_) {}
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        lang: el.langSelect.value,
        timestamps: el.timestampToggle.checked,
        translate: el.translateToggle.checked,
      }));
    } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // Speakers
  // ---------------------------------------------------------------------------
  function getSpeaker(id) {
    return speakers.find((s) => s.id === id) || speakers[0];
  }

  function renderSpeakerChips() {
    el.speakerChips.innerHTML = "";
    for (let i = 0; i < speakers.length; i++) {
      const s = speakers[i];
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip" + (s.id === activeSpeakerId ? " is-active" : "");
      chip.dataset.id = s.id;
      chip.title = `Set active speaker (key ${i + 1}) · double-click to rename`;
      if (s.id === activeSpeakerId) {
        chip.style.background = s.color;
        chip.style.borderColor = s.color;
      } else {
        chip.style.background = "";
        chip.style.borderColor = "";
      }

      const dot = document.createElement("span");
      dot.className = "chip-dot";
      dot.style.background = s.id === activeSpeakerId ? "#fff" : s.color;
      chip.appendChild(dot);

      const name = document.createElement("span");
      name.textContent = s.name;
      chip.appendChild(name);

      chip.addEventListener("click", () => setActiveSpeaker(s.id));
      chip.addEventListener("dblclick", (e) => { e.preventDefault(); renameSpeaker(s.id); });
      el.speakerChips.appendChild(chip);
    }
    el.addSpeakerBtn.disabled = speakers.length >= MAX_SPEAKERS;
  }

  function setActiveSpeaker(id) {
    activeSpeakerId = id;
    renderSpeakerChips();
    saveState();
  }

  function addSpeaker() {
    if (speakers.length >= MAX_SPEAKERS) return;
    speakerSeq += 1;
    const idx = speakers.length;
    speakers.push({
      id: "s" + speakerSeq,
      name: "Speaker " + (idx + 1),
      color: SPEAKER_COLORS[idx % SPEAKER_COLORS.length],
    });
    renderSpeakerChips();
    saveState();
  }

  function renameSpeaker(id) {
    const s = getSpeaker(id);
    const name = window.prompt("Speaker name:", s.name);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    s.name = trimmed;
    renderSpeakerChips();
    renderTranscript();
    saveState();
  }

  // ---------------------------------------------------------------------------
  // Translation
  // ---------------------------------------------------------------------------
  function translationPair(lang) {
    // English <-> Chinese, direction chosen by the captured language.
    if (lang && lang.toLowerCase().indexOf("zh") === 0) {
      return { src: "zh-CN", tgt: "en" };
    }
    return { src: "en", tgt: "zh-CN" };
  }

  async function translateText(text, src, tgt) {
    // Primary: Google's free gtx endpoint (fast, good quality).
    try {
      const u =
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl=" +
        encodeURIComponent(src) + "&tl=" + encodeURIComponent(tgt) +
        "&dt=t&q=" + encodeURIComponent(text);
      const r = await fetch(u);
      if (r.ok) {
        const d = await r.json();
        if (Array.isArray(d) && Array.isArray(d[0])) {
          const out = d[0].map((seg) => (seg && seg[0]) ? seg[0] : "").join("");
          if (out.trim()) return out;
        }
      }
    } catch (_) {}

    // Fallback: MyMemory (CORS-friendly, no key).
    try {
      const u =
        "https://api.mymemory.translated.net/get?q=" +
        encodeURIComponent(text) + "&langpair=" + encodeURIComponent(src + "|" + tgt);
      const r = await fetch(u);
      if (r.ok) {
        const d = await r.json();
        const out = d && d.responseData && d.responseData.translatedText;
        if (out && !/^MYMEMORY WARNING/i.test(out)) return out;
      }
    } catch (_) {}

    return null;
  }

  async function translateLine(line) {
    if (!el.translateToggle.checked) return;
    const pair = translationPair(line.lang);
    line._translating = true;
    line._failed = false;
    updateLineNode(line);

    const out = await translateText(line.text, pair.src, pair.tgt);
    line._translating = false;
    line.translation = out;
    line._failed = !out;
    updateLineNode(line);
    saveState();
  }

  async function translateMissing() {
    for (const line of lines) {
      if (!el.translateToggle.checked) break;
      if (line.translation) continue;
      await translateLine(line);
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function nowLabel() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function buildLineNode(line) {
    const speaker = getSpeaker(line.speaker);
    const row = document.createElement("div");
    row.className = "line";
    row.style.borderLeftColor = speaker.color;

    if (el.timestampToggle.checked && line.time) {
      const t = document.createElement("span");
      t.className = "line-time";
      t.textContent = line.time;
      row.appendChild(t);
    }

    const body = document.createElement("div");
    body.className = "line-body";

    const sp = document.createElement("span");
    sp.className = "line-speaker";
    sp.style.color = speaker.color;
    sp.textContent = speaker.name + ":";
    body.appendChild(sp);

    const txt = document.createElement("span");
    txt.className = "line-text";
    txt.textContent = line.text;
    body.appendChild(txt);

    if (el.translateToggle.checked && (line.translation || line._translating || line._failed)) {
      const tr = document.createElement("div");
      tr.className = "line-translation";
      if (line._translating) {
        tr.classList.add("is-pending");
        tr.textContent = "translating…";
      } else if (line._failed) {
        tr.classList.add("is-failed");
        tr.textContent = "translation unavailable";
      } else {
        tr.textContent = line.translation;
      }
      body.appendChild(tr);
    }

    row.appendChild(body);
    return row;
  }

  function updateLineNode(line) {
    if (!line._node) return;
    const fresh = buildLineNode(line);
    if (line._node.parentNode) line._node.parentNode.replaceChild(fresh, line._node);
    line._node = fresh;
  }

  function nearBottom() {
    const t = el.transcript;
    return t.scrollHeight - t.scrollTop - t.clientHeight < 80;
  }

  function renderTranscript() {
    el.transcript.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (const line of lines) {
      const node = buildLineNode(line);
      line._node = node;
      frag.appendChild(node);
    }
    el.transcript.appendChild(frag);
    el.transcript.scrollTop = el.transcript.scrollHeight;
    updateStats();
    updateButtonStates();
  }

  function appendLine(text) {
    const clean = text.trim();
    if (!clean) return;
    const line = {
      time: nowLabel(),
      text: clean,
      speaker: activeSpeakerId,
      lang: el.langSelect.value,
      translation: null,
    };
    const wasNear = nearBottom();
    lines.push(line);
    const node = buildLineNode(line);
    line._node = node;
    el.transcript.appendChild(node);
    if (wasNear) el.transcript.scrollTop = el.transcript.scrollHeight;

    updateStats();
    updateButtonStates();
    saveState();
    if (el.translateToggle.checked) translateLine(line);
  }

  function countWords() {
    let words = 0;
    for (const line of lines) {
      const t = (line.text || "").trim();
      if (!t) continue;
      const cjk = (t.match(/[㐀-鿿豈-﫿]/g) || []).length;
      const rest = t.replace(/[㐀-鿿豈-﫿]/g, " ").trim();
      const latin = rest ? rest.split(/\s+/).filter(Boolean).length : 0;
      words += cjk + latin;
    }
    return words;
  }

  function updateStats() {
    const n = lines.length;
    el.stats.textContent = `${n} line${n === 1 ? "" : "s"} · ${countWords()} words`;
  }

  function updateButtonStates() {
    const has = lines.length > 0;
    el.copyBtn.disabled = !has;
    el.exportBtn.disabled = !has;
    el.clearBtn.disabled = !has;
  }

  function setLiveCaption(text, interim) {
    if (!text) {
      el.liveCaption.className = "caption-text caption-placeholder";
      el.liveCaption.innerHTML =
        "Press <strong>Start</strong> and begin speaking — your words appear here in real time.";
      return;
    }
    el.liveCaption.className = "caption-text" + (interim ? " caption-interim" : "");
    el.liveCaption.textContent = text;
  }

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------
  function setStatus(state, text) {
    el.statusText.textContent = text;
    el.status.classList.toggle("is-recording", state === "recording");
  }

  function setRecordingUI(on) {
    recording = on;
    el.recordBtn.classList.toggle("is-recording", on);
    el.recordBtnLabel.textContent = on ? "Stop" : "Start";
    el.langSelect.disabled = on;
    if (on) {
      setStatus("recording", "Listening…");
    } else {
      setStatus("idle", "Ready");
      setLiveCaption("");
    }
  }

  // ---------------------------------------------------------------------------
  // Speech recognition
  // ---------------------------------------------------------------------------
  function getRecognitionClass() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function buildRecognition() {
    const SR = getRecognitionClass();
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = el.langSelect.value;
    r.maxAlternatives = 1;

    r.onstart = function () { setRecordingUI(true); };

    r.onresult = function (event) {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        if (result.isFinal) {
          appendLine(transcript);
          interim = "";
        } else {
          interim += transcript;
        }
      }
      if (interim) {
        setLiveCaption(interim, true);
      } else if (lines.length) {
        setLiveCaption(lines[lines.length - 1].text, false);
      }
    };

    r.onerror = function (event) {
      const err = event.error;
      if (err === "not-allowed" || err === "service-not-allowed") {
        stoppedByUser = true;
        setStatus("idle", "Microphone blocked");
        showToast("Microphone permission is required. Enable it and try again.");
      } else if (err === "no-speech") {
        setStatus("recording", "Listening… (no speech yet)");
      } else if (err === "audio-capture") {
        stoppedByUser = true;
        showToast("No microphone found. Check your audio device.");
      } else if (err !== "aborted") {
        setStatus("recording", "Reconnecting…");
      }
    };

    r.onend = function () {
      if (recording && !stoppedByUser) {
        clearTimeout(restartTimer);
        restartTimer = setTimeout(() => {
          try { r.start(); } catch (_) {}
        }, 250);
      } else {
        setRecordingUI(false);
      }
    };

    return r;
  }

  function startRecording() {
    const SR = getRecognitionClass();
    if (!SR) { showUnsupported(); return; }
    stoppedByUser = false;
    try {
      recognition = buildRecognition();
      recognition.start();
      setRecordingUI(true);
    } catch (_) {
      showToast("Could not start recording. Try again.");
      setRecordingUI(false);
    }
  }

  function stopRecording() {
    stoppedByUser = true;
    recording = false;
    clearTimeout(restartTimer);
    if (recognition) { try { recognition.stop(); } catch (_) {} }
    setRecordingUI(false);
  }

  function toggleRecording() {
    if (recording) stopRecording();
    else startRecording();
  }

  // ---------------------------------------------------------------------------
  // File transcription — Whisper running in the browser (no microphone, no server)
  // ---------------------------------------------------------------------------
  function whisperLang(lang) {
    return lang && lang.toLowerCase().indexOf("zh") === 0 ? "chinese" : "english";
  }

  function secondsToLabel(s) {
    s = Math.max(0, Math.floor(s || 0));
    const p = (n) => String(n).padStart(2, "0");
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
  }

  function showFileProgress(on) { el.fileProgress.hidden = !on; }
  function setFpText(text) { el.fpText.textContent = text; }
  function setFpFill(pct) {
    el.fpFill.classList.remove("indeterminate");
    el.fpFill.style.width = Math.max(0, Math.min(100, pct)) + "%";
  }
  function setFpIndeterminate(on) {
    if (on) { el.fpFill.style.width = ""; el.fpFill.classList.add("indeterminate"); }
    else { el.fpFill.classList.remove("indeterminate"); }
  }

  function getWorker() {
    if (!whisperWorker) {
      whisperWorker = new Worker("worker.js", { type: "module" });
    }
    return whisperWorker;
  }

  // Run transcription in the worker. Reports download/load progress, fires
  // onReady when the model is loaded and inference is starting, and resolves
  // with the Whisper result. The audio buffer is transferred (zero-copy).
  function transcribeInWorker(audio, language, onProgress, onReady) {
    return new Promise((resolve, reject) => {
      const w = getWorker();
      const cleanup = () => {
        w.removeEventListener("message", handler);
        w.removeEventListener("error", errHandler);
      };
      const handler = (event) => {
        const m = event.data || {};
        if (m.type === "progress") {
          onProgress(m.data);
        } else if (m.type === "ready") {
          onReady();
        } else if (m.type === "result") {
          cleanup();
          resolve(m.result);
        } else if (m.type === "error") {
          cleanup();
          reject(new Error(m.message || "worker-error"));
        }
      };
      // Fires if the worker script itself fails to load (e.g. the model CDN is
      // unreachable). Drop the dead worker so the next attempt recreates it.
      const errHandler = (e) => {
        cleanup();
        if (whisperWorker === w) { whisperWorker = null; }
        reject(new Error("worker-load-failed"));
      };
      w.addEventListener("message", handler);
      w.addEventListener("error", errHandler);
      w.postMessage({ type: "transcribe", audio: audio, language: language }, [audio.buffer]);
    });
  }

  // Decode any browser-playable media into mono 16 kHz PCM (what Whisper needs).
  async function decodeAudio(file) {
    const buf = await file.arrayBuffer();
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const tmp = new Ctx();
    let decoded;
    try {
      decoded = await tmp.decodeAudioData(buf.slice(0));
    } finally {
      if (tmp.close) tmp.close();
    }
    const targetRate = 16000;
    const frames = Math.max(1, Math.ceil(decoded.duration * targetRate));
    const offline = new OfflineAudioContext(1, frames, targetRate);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start(0);
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0);
  }

  function addFileLines(chunks) {
    let added = 0;
    for (const c of chunks) {
      const text = (c.text || "").trim();
      if (!text) continue;
      const start = c.timestamp && c.timestamp[0] != null ? c.timestamp[0] : 0;
      lines.push({
        time: secondsToLabel(start),
        text: text,
        speaker: activeSpeakerId,
        lang: el.langSelect.value,
        translation: null,
      });
      added += 1;
    }
    renderTranscript();
    saveState();
    return added;
  }

  async function processFile(file) {
    if (processingFile) return;
    const token = ++fileToken;
    const cancelled = () => token !== fileToken;

    processingFile = true;
    el.recordBtn.disabled = true;
    el.fileBtn.disabled = true;
    showFileProgress(true);
    setFpIndeterminate(true);
    setFpText(`Decoding “${file.name}”…`);

    try {
      // Decoding is quick; do it on the main thread, then hand the audio to
      // the worker for the heavy transcription so the UI stays responsive.
      let audio;
      try {
        audio = await decodeAudio(file);
      } catch (_) {
        throw new Error("decode-failed");
      }
      if (cancelled()) return;

      const mins = Math.round((audio.length / 16000 / 60) * 10) / 10;
      setFpText("Loading transcription model… (one-time download, then cached)");

      const onProgress = (p) => {
        if (!p) return;
        if (p.status === "progress" && p.file && typeof p.progress === "number") {
          const name = String(p.file).split("/").pop();
          setFpFill(Math.round(p.progress));
          setFpText(`Downloading model — ${name} ${Math.round(p.progress)}% (one-time)`);
        }
      };
      const onReady = () => {
        if (cancelled()) return;
        setFpIndeterminate(true);
        setFpText(`Transcribing “${file.name}” (~${mins} min of audio)…`);
      };

      const result = await transcribeInWorker(audio, whisperLang(el.langSelect.value), onProgress, onReady);
      if (cancelled()) return;

      const chunks = result && result.chunks && result.chunks.length
        ? result.chunks
        : [{ timestamp: [0, null], text: (result && result.text) || "" }];
      const added = addFileLines(chunks);

      showFileProgress(false);
      if (added > 0) {
        showToast(`Transcribed ${added} segment${added === 1 ? "" : "s"} from ${file.name}`);
        if (el.translateToggle.checked) translateMissing();
      } else {
        showToast("No speech was detected in that file.");
      }
    } catch (err) {
      showFileProgress(false);
      if (err && err.message === "decode-failed") {
        showToast("Couldn't read that file's audio. Try mp3, wav, m4a, or a standard mp4.");
      } else {
        showToast("Couldn't load the speech model. For offline use, run scripts/fetch-model.sh (see models/README.md).");
      }
    } finally {
      processingFile = false;
      el.fileBtn.disabled = false;
      if (getRecognitionClass()) el.recordBtn.disabled = false;
      setFpIndeterminate(false);
    }
  }

  function cancelFile() {
    fileToken += 1; // invalidate the in-flight job's results
    // Terminating the worker truly stops in-progress compute (the model files
    // stay cached by the browser, so the next run starts quickly).
    if (whisperWorker) {
      whisperWorker.terminate();
      whisperWorker = null;
    }
    showFileProgress(false);
    setFpIndeterminate(false);
    processingFile = false;
    el.fileBtn.disabled = false;
    if (getRecognitionClass()) el.recordBtn.disabled = false;
    showToast("Cancelled");
  }

  // ---------------------------------------------------------------------------
  // Desktop live streaming (Electron) — mic or system audio → Whisper
  // ---------------------------------------------------------------------------
  function setStreamUI(on, kind) {
    const micActive = on && kind === "mic";
    const sysActive = on && kind === "system";
    el.recordBtn.classList.toggle("is-recording", micActive);
    el.recordBtnLabel.textContent = micActive ? "Stop" : "Start";
    el.sysAudioBtn.classList.toggle("is-recording", sysActive);
    if (el.sysAudioLabel) el.sysAudioLabel.textContent = sysActive ? "Stop" : "System audio";
    el.langSelect.disabled = on;
    el.fileBtn.disabled = on;
    if (on) {
      setStatus("recording", kind === "system" ? "Capturing system audio…" : "Listening…");
    } else {
      setStatus("idle", "Ready");
      setLiveCaption("");
    }
  }

  async function startStreaming(kind) {
    if (streaming) return;
    let stream;
    try {
      if (kind === "system") {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        stream.getVideoTracks().forEach((t) => t.stop());
        if (!stream.getAudioTracks().length) throw new Error("no-audio");
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
    } catch (e) {
      showToast(kind === "system"
        ? "Couldn't capture system audio. Make sure something is playing and try again."
        : "Couldn't access the microphone. Check permissions.");
      return;
    }

    mediaStream = stream;
    streaming = true;
    streamSource = kind;
    setStreamUI(true, kind);
    setLiveCaption("Transcribing live… (first segment loads the model)", true);

    const Ctx = window.AudioContext || window.webkitAudioContext;
    streamCtx = new Ctx({ sampleRate: STREAM_SR });
    streamSrcNode = streamCtx.createMediaStreamSource(stream);
    streamNode = streamCtx.createScriptProcessor(4096, 1, 1);
    streamGain = streamCtx.createGain();
    streamGain.gain.value = 0; // don't play the audio back (no echo)

    pcmBuf = []; pcmLen = 0; silentMs = 0; voicedMs = 0;
    streamNode.onaudioprocess = function (e) {
      if (!streaming) return;
      const input = e.inputBuffer.getChannelData(0);
      const chunk = new Float32Array(input); // copy out of the reused buffer
      let sum = 0;
      for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
      const rms = Math.sqrt(sum / chunk.length);
      const ms = (chunk.length / STREAM_SR) * 1000;

      pcmBuf.push(chunk);
      pcmLen += chunk.length;
      if (rms < SILENCE_RMS) { silentMs += ms; }
      else { silentMs = 0; voicedMs += ms; }

      const totalMs = (pcmLen / STREAM_SR) * 1000;
      if ((silentMs >= SILENCE_HOLD_MS && voicedMs >= MIN_SPEECH_MS) || totalMs >= MAX_SEG_MS) {
        flushSegment();
      }
    };

    streamSrcNode.connect(streamNode);
    streamNode.connect(streamGain);
    streamGain.connect(streamCtx.destination);
  }

  function flushSegment() {
    if (pcmLen < MIN_SEG_SAMPLES) {
      if (!streaming) { pcmBuf = []; pcmLen = 0; }
      return;
    }
    const seg = new Float32Array(pcmLen);
    let off = 0;
    for (const c of pcmBuf) { seg.set(c, off); off += c.length; }
    pcmBuf = []; pcmLen = 0; silentMs = 0; voicedMs = 0;
    segQueue.push(seg);
    pumpQueue();
  }

  async function pumpQueue() {
    if (segInFlight || !segQueue.length) return;
    segInFlight = true;
    const seg = segQueue.shift();
    try {
      const result = await transcribeInWorker(
        seg, whisperLang(el.langSelect.value), function () {}, function () {}
      );
      const text = (result && (result.text ||
        (result.chunks || []).map((c) => c.text).join(" "))) || "";
      const clean = text.trim();
      if (clean) appendLine(clean);
    } catch (_) { /* skip a failed segment, keep going */ }
    segInFlight = false;
    if (segQueue.length) pumpQueue();
  }

  function stopStreaming() {
    if (!streaming) return;
    streaming = false;
    if (streamNode) { streamNode.onaudioprocess = null; try { streamNode.disconnect(); } catch (_) {} }
    if (streamSrcNode) { try { streamSrcNode.disconnect(); } catch (_) {} }
    if (streamGain) { try { streamGain.disconnect(); } catch (_) {} }
    if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
    flushSegment(); // transcribe whatever is left
    if (streamCtx && streamCtx.close) { try { streamCtx.close(); } catch (_) {} }
    streamCtx = null; streamSrcNode = null; streamNode = null; streamGain = null; mediaStream = null;
    setStreamUI(false, streamSource);
    streamSource = "";
  }

  function toggleStream(kind) {
    if (streaming && streamSource === kind) { stopStreaming(); return; }
    if (streaming) { showToast("Stop the current capture first."); return; }
    startStreaming(kind);
  }

  // ---------------------------------------------------------------------------
  // Export / copy / clear
  // ---------------------------------------------------------------------------
  function transcriptToText() {
    const showTime = el.timestampToggle.checked;
    const showTr = el.translateToggle.checked;
    const out = [];
    for (const line of lines) {
      const speaker = getSpeaker(line.speaker).name;
      const prefix = showTime && line.time ? `[${line.time}] ` : "";
      out.push(`${prefix}${speaker}: ${line.text}`);
      if (showTr && line.translation) out.push(`    ↳ ${line.translation}`);
    }
    return out.join("\n");
  }

  async function copyTranscript() {
    const text = transcriptToText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast("Transcript copied to clipboard");
    } catch (_) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); showToast("Transcript copied to clipboard"); }
      catch (e) { showToast("Copy failed — select the text manually."); }
      document.body.removeChild(ta);
    }
  }

  function exportTranscript() {
    const text = transcriptToText();
    if (!text) return;
    const stamp = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "-");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `meeting-solo_${stamp}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Transcript exported");
  }

  function clearTranscript() {
    if (!lines.length) return;
    const ok = window.confirm(
      "Clear the entire transcript? This can't be undone.\n\nTip: use Export first if you want to keep a copy."
    );
    if (!ok) return;
    lines = [];
    saveState();
    renderTranscript();
    setLiveCaption("");
    showToast("Transcript cleared");
  }

  // ---------------------------------------------------------------------------
  // UI helpers
  // ---------------------------------------------------------------------------
  let toastTimer = null;
  function showToast(message) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    void el.toast.offsetWidth;
    el.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toast.classList.remove("show");
      setTimeout(() => { el.toast.hidden = true; }, 250);
    }, 2200);
  }

  function showUnsupported() {
    el.unsupported.hidden = false;
    el.recordBtn.disabled = true;
    setStatus("idle", "Not supported");
  }

  function isTypingTarget(t) {
    return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------
  function init() {
    loadState();
    renderSpeakerChips();
    renderTranscript();

    if (IS_DESKTOP) {
      // Desktop app: the Web Speech API isn't available in Electron, so live
      // capture (mic and system audio) goes through Whisper streaming instead.
      el.sysAudioBtn.hidden = false;
      el.recordBtn.disabled = false;
      el.recordBtn.title = "Transcribe microphone audio live (Whisper)";
      // macOS/Linux system-audio loopback is OS-dependent; hint it on non-Windows.
      if (window.meetingSoloDesktop.platform !== "win32") {
        el.sysAudioBtn.title = "Capture system audio (best on Windows; may need a loopback device on macOS/Linux)";
      }
    } else if (!getRecognitionClass()) {
      showUnsupported();
    }

    el.recordBtn.addEventListener("click", function () {
      if (IS_DESKTOP) toggleStream("mic");
      else toggleRecording();
    });
    el.sysAudioBtn.addEventListener("click", function () { toggleStream("system"); });
    el.fileBtn.addEventListener("click", function () {
      if (recording) { showToast("Stop recording before transcribing a file."); return; }
      el.fileInput.click();
    });
    el.fileInput.addEventListener("change", function () {
      const file = el.fileInput.files && el.fileInput.files[0];
      el.fileInput.value = ""; // allow re-selecting the same file later
      if (file) processFile(file);
    });
    el.fpCancel.addEventListener("click", cancelFile);
    el.copyBtn.addEventListener("click", copyTranscript);
    el.exportBtn.addEventListener("click", exportTranscript);
    el.clearBtn.addEventListener("click", clearTranscript);
    el.addSpeakerBtn.addEventListener("click", addSpeaker);

    el.langSelect.addEventListener("change", function () {
      savePrefs();
      if (recognition) recognition.lang = el.langSelect.value;
    });

    el.timestampToggle.addEventListener("change", function () {
      savePrefs();
      renderTranscript();
    });

    el.translateToggle.addEventListener("change", function () {
      savePrefs();
      renderTranscript();
      if (el.translateToggle.checked) translateMissing();
    });

    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (el.recordBtn.disabled) return;
        if (IS_DESKTOP) toggleStream("mic");
        else toggleRecording();
        return;
      }
      // Number keys 1-9 select a speaker (when not typing in a field).
      if (!e.ctrlKey && !e.metaKey && !e.altKey && /^[1-9]$/.test(e.key) && !isTypingTarget(e.target)) {
        const idx = parseInt(e.key, 10) - 1;
        if (idx < speakers.length) { setActiveSpeaker(speakers[idx].id); }
      }
    });

    window.addEventListener("beforeunload", function (e) {
      if (recording || streaming) { e.preventDefault(); e.returnValue = ""; }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
