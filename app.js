/* Meeting Solo — Live Captions, Translation & Transcript
 *
 *   - Unlimited transcript (every finalized line is kept), one line per utterance
 *   - Automatic English <-> Chinese translation based on the selected language
 *   - Copy & export (clipboard / .txt), persistence (localStorage)
 *   - File transcription and (desktop) live capture via Whisper in a Web Worker
 */

(function () {
  "use strict";

  const STORAGE_KEY = "meeting-solo.state.v2";
  const LEGACY_KEY = "meeting-solo.transcript.v1";
  const PREFS_KEY = "meeting-solo.prefs.v1";

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
    timestampToggle: document.getElementById("timestampToggle"),
    copyBtn: document.getElementById("copyBtn"),
    exportBtn: document.getElementById("exportBtn"),
    clearBtn: document.getElementById("clearBtn"),
    liveCaption: document.getElementById("liveCaption"),
    transcript: document.getElementById("transcript"),
    stats: document.getElementById("stats"),
    status: document.getElementById("status"),
    statusText: document.getElementById("statusText"),
    unsupported: document.getElementById("unsupported"),
    toast: document.getElementById("toast"),
  };

  // --- State ---
  /** @type {{time:string, text:string, lang:string, translation:?string, _node?:Element, _translating?:boolean, _failed?:boolean}[]} */
  let lines = [];

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
  const SILENCE_HOLD_MS = 550;    // silence this long ends a segment
  const MIN_SPEECH_MS = 600;      // need at least this much speech to flush
  const MAX_SEG_MS = 9000;        // hard cap so long talk still flushes as a line
  const MIN_SEG_SAMPLES = STREAM_SR * 0.4;
  const INTERIM_MIN_MS = 800;     // min voiced audio before showing a live preview
  const INTERIM_THROTTLE_MS = 1000; // don't preview more often than this
  let streaming = false;
  let streamSource = "";          // "mic" | "system"
  let streamCtx = null, streamNode = null, streamSrcNode = null, streamGain = null;
  let mediaStream = null;
  let pcmBuf = [], pcmLen = 0, silentMs = 0, voicedMs = 0;
  let segQueue = [], workerBusy = false;
  let lastInterimAt = 0;          // performance.now() of the last live preview

  // ---------------------------------------------------------------------------
  // Text cleanup
  // ---------------------------------------------------------------------------
  // Whisper can hallucinate on music/near-silence, emitting a short unit over and
  // over (e.g. "字幕: 字幕: 字幕: …" or "Subtitles: Subtitles: …"). Collapse any
  // short unit repeated 3+ times down to a single occurrence.
  function collapseRepeats(text) {
    if (!text) return "";
    let s = String(text).replace(/(.{1,20}?)\1{2,}/gs, "$1");
    return s.trim();
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------
  function loadState() {
    let loaded = null;
    try { loaded = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch (_) {}

    if (loaded && Array.isArray(loaded.lines)) {
      lines = loaded.lines;
    } else if (Array.isArray(loaded)) {
      lines = loaded;
    } else {
      try {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null");
        if (Array.isArray(legacy)) lines = legacy;
      } catch (_) {}
    }

    for (const line of lines) {
      if (!line.lang) line.lang = "en-US";
      if (!("translation" in line)) line.translation = null;
    }

    try {
      const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
      if (prefs.lang) el.langSelect.value = prefs.lang;
      if (typeof prefs.timestamps === "boolean") el.timestampToggle.checked = prefs.timestamps;
    } catch (_) {}
  }

  function saveState() {
    try {
      const cleanLines = lines.map((l) => ({
        time: l.time, text: l.text, lang: l.lang, translation: l.translation || null,
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ lines: cleanLines }));
    } catch (_) {}
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        lang: el.langSelect.value,
        timestamps: el.timestampToggle.checked,
      }));
    } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // Translation (automatic, based on the selected language)
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
    const row = document.createElement("div");
    row.className = "line";

    if (el.timestampToggle.checked && line.time) {
      const t = document.createElement("span");
      t.className = "line-time";
      t.textContent = line.time;
      row.appendChild(t);
    }

    const body = document.createElement("div");
    body.className = "line-body";

    const txt = document.createElement("span");
    txt.className = "line-text";
    txt.textContent = line.text;
    body.appendChild(txt);

    if (line.translation || line._translating || line._failed) {
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
    const clean = collapseRepeats((text || "").trim());
    if (!clean) return;
    const line = {
      time: nowLabel(),
      text: clean,
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
    translateLine(line);
  }

  function countWords() {
    let words = 0;
    for (const line of lines) {
      const t = (line.text || "").trim();
      if (!t) continue;
      const cjk = (t.match(/[㐀-鿿豈-﫿]/g) || []).length;
      const rest = t.replace(/[㐀-鿿豈-﫿]/g, " ").trim();
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
  // Speech recognition (browser microphone via Web Speech API)
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
  // File transcription — Whisper running locally (no microphone, no server)
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
      const text = collapseRepeats((c.text || "").trim());
      if (!text) continue;
      const start = c.timestamp && c.timestamp[0] != null ? c.timestamp[0] : 0;
      lines.push({
        time: secondsToLabel(start),
        text: text,
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
    el.sysAudioBtn.disabled = true;
    showFileProgress(true);
    setFpIndeterminate(true);
    setFpText(`Decoding “${file.name}”…`);

    try {
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
        translateMissing();
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
      if (IS_DESKTOP) { el.sysAudioBtn.disabled = false; el.recordBtn.disabled = false; }
      else if (getRecognitionClass()) el.recordBtn.disabled = false;
      setFpIndeterminate(false);
    }
  }

  function cancelFile() {
    fileToken += 1; // invalidate the in-flight job's results
    if (whisperWorker) {
      whisperWorker.terminate();
      whisperWorker = null;
    }
    showFileProgress(false);
    setFpIndeterminate(false);
    processingFile = false;
    el.fileBtn.disabled = false;
    if (IS_DESKTOP) { el.sysAudioBtn.disabled = false; el.recordBtn.disabled = false; }
    else if (getRecognitionClass()) el.recordBtn.disabled = false;
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
    el.recordBtn.disabled = on && !micActive;
    el.sysAudioBtn.disabled = on && !sysActive;
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
    segQueue = []; workerBusy = false; lastInterimAt = 0;

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
      const silenceEnd = silentMs >= SILENCE_HOLD_MS && voicedMs >= MIN_SPEECH_MS;
      const hardCap = totalMs >= MAX_SEG_MS;
      if (silenceEnd || hardCap) {
        flushSegment();
      } else {
        dispatch(); // maybe render a live interim preview
      }
    };

    streamSrcNode.connect(streamNode);
    streamNode.connect(streamGain);
    streamGain.connect(streamCtx.destination);
  }

  // Concatenate the buffered audio without clearing it (for live previews).
  function snapshotPcm() {
    const seg = new Float32Array(pcmLen);
    let off = 0;
    for (const c of pcmBuf) { seg.set(c, off); off += c.length; }
    return seg;
  }

  function resultText(result) {
    return (result && (result.text ||
      (result.chunks || []).map((c) => c.text).join(" "))) || "";
  }

  function flushSegment() {
    if (pcmLen < MIN_SEG_SAMPLES) {
      if (!streaming) { pcmBuf = []; pcmLen = 0; }
      return;
    }
    const seg = snapshotPcm();
    pcmBuf = []; pcmLen = 0; silentMs = 0; voicedMs = 0;
    segQueue.push(seg);
    dispatch();
  }

  // One worker job at a time. Finalized segments (which append transcript lines)
  // take priority; when none are pending, a throttled interim preview of the
  // audio currently being spoken is shown in the live caption bar.
  async function dispatch() {
    if (workerBusy) return;

    if (segQueue.length) {
      workerBusy = true;
      const seg = segQueue.shift();
      try {
        const result = await transcribeInWorker(
          seg, whisperLang(el.langSelect.value), function () {}, function () {}
        );
        const txt = resultText(result);
        if (txt.trim()) appendLine(txt);
      } catch (_) { /* skip a failed segment */ }
      workerBusy = false;
      dispatch();
      return;
    }

    if (!streaming) return;
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
    const bufferedMs = (pcmLen / STREAM_SR) * 1000;
    if (voicedMs >= INTERIM_MIN_MS && bufferedMs >= INTERIM_MIN_MS &&
        (now - lastInterimAt) >= INTERIM_THROTTLE_MS) {
      lastInterimAt = now;
      workerBusy = true;
      const snap = snapshotPcm();
      try {
        const result = await transcribeInWorker(
          snap, whisperLang(el.langSelect.value), function () {}, function () {}
        );
        const clean = collapseRepeats(resultText(result).trim());
        if (streaming && clean && !segQueue.length) setLiveCaption(clean, true);
      } catch (_) {}
      workerBusy = false;
      dispatch();
    }
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
    const out = [];
    for (const line of lines) {
      const prefix = showTime && line.time ? `[${line.time}] ` : "";
      out.push(`${prefix}${line.text}`);
      if (line.translation) out.push(`    ↳ ${line.translation}`);
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

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------
  function init() {
    loadState();
    renderTranscript();

    if (IS_DESKTOP) {
      // Desktop app: the Web Speech API isn't available in Electron, so live
      // capture (mic and system audio) goes through Whisper streaming instead.
      el.sysAudioBtn.hidden = false;
      el.recordBtn.disabled = false;
      el.recordBtn.title = "Transcribe microphone audio live (Whisper)";
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
      if (recording || streaming) { showToast("Stop the current capture before transcribing a file."); return; }
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

    el.langSelect.addEventListener("change", function () {
      savePrefs();
      if (recognition) recognition.lang = el.langSelect.value;
    });

    el.timestampToggle.addEventListener("change", function () {
      savePrefs();
      renderTranscript();
    });

    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (el.recordBtn.disabled) return;
        if (IS_DESKTOP) toggleStream("mic");
        else toggleRecording();
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
