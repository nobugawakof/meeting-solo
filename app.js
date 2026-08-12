/* Meeting Solo — Live Captions & Transcript
 *
 *   - Unlimited transcript (every finalized line is kept), one line per utterance
 *   - A single "Start" captures everything: your mic AND any app's audio
 *     (Meet, Lark, Telegram, Zoom, a media player) on the desktop app
 *   - File transcription of recordings, all via Whisper in a Web Worker
 *   - Copy & export (clipboard / .txt), persistence (localStorage)
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
    fileProgress: document.getElementById("fileProgress"),
    fpText: document.getElementById("fpText"),
    fpFill: document.getElementById("fpFill"),
    fpCancel: document.getElementById("fpCancel"),
    langSelect: document.getElementById("langSelect"),
    timestampToggle: document.getElementById("timestampToggle"),
    copyBtn: document.getElementById("copyBtn"),
    exportBtn: document.getElementById("exportBtn"),
    clearBtn: document.getElementById("clearBtn"),
    transcript: document.getElementById("transcript"),
    stats: document.getElementById("stats"),
    status: document.getElementById("status"),
    statusText: document.getElementById("statusText"),
    unsupported: document.getElementById("unsupported"),
    toast: document.getElementById("toast"),
  };

  // --- State ---
  /** @type {{time:string, text:string, lang:string, _node?:Element}[]} */
  let lines = [];
  let interimNode = null; // transient "live" line shown at the bottom while speaking

  let recognition = null;
  let recording = false;
  let stoppedByUser = false;
  let restartTimer = null;

  // Whisper (Web Worker) — used for file transcription and desktop live capture.
  let whisperWorker = null;
  let fileToken = 0;
  let processingFile = false;

  const IS_DESKTOP = !!(window.meetingSoloDesktop);
  const STREAM_SR = 16000;
  const SILENCE_RMS = 0.008;
  const SILENCE_HOLD_MS = 550;
  const MIN_SPEECH_MS = 600;
  const MAX_SEG_MS = 9000;
  const MIN_SEG_SAMPLES = STREAM_SR * 0.4;
  const INTERIM_MIN_MS = 800;
  const INTERIM_THROTTLE_MS = 1000;
  let streaming = false;
  let streamCtx = null, streamNode = null, streamGain = null;
  let streamSrcNodes = [], mediaStreams = [];
  let pcmBuf = [], pcmLen = 0, silentMs = 0, voicedMs = 0;
  let segQueue = [], workerBusy = false;
  let lastInterimAt = 0;

  // ---------------------------------------------------------------------------
  // Text cleanup — collapse Whisper's repeated-phrase hallucinations
  // ---------------------------------------------------------------------------
  function collapseRepeats(text) {
    if (!text) return "";
    return String(text).replace(/(.{1,20}?)\1{2,}/gs, "$1").trim();
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------
  function loadState() {
    let loaded = null;
    try { loaded = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch (_) {}

    if (loaded && Array.isArray(loaded.lines)) lines = loaded.lines;
    else if (Array.isArray(loaded)) lines = loaded;
    else {
      try {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null");
        if (Array.isArray(legacy)) lines = legacy;
      } catch (_) {}
    }
    for (const line of lines) { if (!line.lang) line.lang = "en-US"; }

    try {
      const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
      if (prefs.lang) el.langSelect.value = prefs.lang;
      if (typeof prefs.timestamps === "boolean") el.timestampToggle.checked = prefs.timestamps;
    } catch (_) {}
  }

  function saveState() {
    try {
      const cleanLines = lines.map((l) => ({ time: l.time, text: l.text, lang: l.lang }));
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
  // Rendering
  // ---------------------------------------------------------------------------
  function nowLabel() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function secondsToLabel(s) {
    s = Math.max(0, Math.floor(s || 0));
    const p = (n) => String(n).padStart(2, "0");
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
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
    row.appendChild(body);
    return row;
  }

  function nearBottom() {
    const t = el.transcript;
    return t.scrollHeight - t.scrollTop - t.clientHeight < 80;
  }

  function scrollIfNear(wasNear) {
    if (wasNear) el.transcript.scrollTop = el.transcript.scrollHeight;
  }

  function renderTranscript() {
    clearInterim();
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

  // The live, still-being-spoken text shows as a transient dimmed line at the
  // bottom of the transcript, then is replaced by the finalized line.
  function setInterim(text) {
    const clean = collapseRepeats((text || "").trim());
    if (!clean) { clearInterim(); return; }
    const wasNear = nearBottom();
    if (!interimNode) {
      interimNode = document.createElement("div");
      interimNode.className = "line line-interim";
      const body = document.createElement("div");
      body.className = "line-body";
      const txt = document.createElement("span");
      txt.className = "line-text";
      body.appendChild(txt);
      interimNode.appendChild(body);
    }
    interimNode.querySelector(".line-text").textContent = clean;
    if (interimNode.parentNode !== el.transcript) el.transcript.appendChild(interimNode);
    scrollIfNear(wasNear);
  }

  function clearInterim() {
    if (interimNode) { if (interimNode.parentNode) interimNode.remove(); interimNode = null; }
  }

  function appendLine(text) {
    const clean = collapseRepeats((text || "").trim());
    if (!clean) return;
    const line = { time: nowLabel(), text: clean, lang: el.langSelect.value };
    const wasNear = nearBottom();
    clearInterim();
    lines.push(line);
    const node = buildLineNode(line);
    line._node = node;
    el.transcript.appendChild(node);
    scrollIfNear(wasNear);
    updateStats();
    updateButtonStates();
    saveState();
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

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------
  function setStatus(state, text) {
    el.statusText.textContent = text;
    el.status.classList.toggle("is-recording", state === "recording");
  }

  function setCaptureUI(on) {
    el.recordBtn.classList.toggle("is-recording", on);
    el.recordBtnLabel.textContent = on ? "Stop" : "Start";
    el.langSelect.disabled = on;
    el.fileBtn.disabled = on;
    if (on) setStatus("recording", "Capturing…");
    else { setStatus("idle", "Ready"); clearInterim(); }
  }

  // ---------------------------------------------------------------------------
  // Browser microphone (Web Speech API)
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

    r.onstart = function () { setCaptureUI(true); };

    r.onresult = function (event) {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        if (result.isFinal) { appendLine(transcript); interim = ""; }
        else interim += transcript;
      }
      setInterim(interim);
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
        restartTimer = setTimeout(() => { try { r.start(); } catch (_) {} }, 250);
      } else {
        recording = false;
        setCaptureUI(false);
      }
    };

    return r;
  }

  function startRecording() {
    const SR = getRecognitionClass();
    if (!SR) { showUnsupported(); return; }
    stoppedByUser = false;
    recording = true;
    try {
      recognition = buildRecognition();
      recognition.start();
      setCaptureUI(true);
    } catch (_) {
      recording = false;
      showToast("Could not start recording. Try again.");
      setCaptureUI(false);
    }
  }

  function stopRecording() {
    stoppedByUser = true;
    recording = false;
    clearTimeout(restartTimer);
    if (recognition) { try { recognition.stop(); } catch (_) {} }
    setCaptureUI(false);
  }

  // ---------------------------------------------------------------------------
  // Whisper worker
  // ---------------------------------------------------------------------------
  function whisperLang(lang) {
    return lang && lang.toLowerCase().indexOf("zh") === 0 ? "chinese" : "english";
  }

  function showFileProgress(on) { el.fileProgress.hidden = !on; }
  function setFpText(text) { el.fpText.textContent = text; }
  function setFpFill(pct) {
    el.fpFill.classList.remove("indeterminate");
    el.fpFill.style.width = Math.max(0, Math.min(100, pct)) + "%";
  }
  function setFpIndeterminate(on) {
    if (on) { el.fpFill.style.width = ""; el.fpFill.classList.add("indeterminate"); }
    else el.fpFill.classList.remove("indeterminate");
  }

  function getWorker() {
    if (!whisperWorker) whisperWorker = new Worker("worker.js", { type: "module" });
    return whisperWorker;
  }

  function transcribeInWorker(audio, language, onProgress, onReady) {
    return new Promise((resolve, reject) => {
      const w = getWorker();
      const cleanup = () => {
        w.removeEventListener("message", handler);
        w.removeEventListener("error", errHandler);
      };
      const handler = (event) => {
        const m = event.data || {};
        if (m.type === "progress") onProgress(m.data);
        else if (m.type === "ready") onReady();
        else if (m.type === "result") { cleanup(); resolve(m.result); }
        else if (m.type === "error") { cleanup(); reject(new Error(m.message || "worker-error")); }
      };
      const errHandler = () => {
        cleanup();
        if (whisperWorker === w) whisperWorker = null;
        reject(new Error("worker-load-failed"));
      };
      w.addEventListener("message", handler);
      w.addEventListener("error", errHandler);
      w.postMessage({ type: "transcribe", audio: audio, language: language }, [audio.buffer]);
    });
  }

  async function decodeAudio(file) {
    const buf = await file.arrayBuffer();
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const tmp = new Ctx();
    let decoded;
    try { decoded = await tmp.decodeAudioData(buf.slice(0)); }
    finally { if (tmp.close) tmp.close(); }
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
      lines.push({ time: secondsToLabel(start), text: text, lang: el.langSelect.value });
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
      let audio;
      try { audio = await decodeAudio(file); }
      catch (_) { throw new Error("decode-failed"); }
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
      showToast(added > 0
        ? `Transcribed ${added} segment${added === 1 ? "" : "s"} from ${file.name}`
        : "No speech was detected in that file.");
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
      if (IS_DESKTOP || getRecognitionClass()) el.recordBtn.disabled = false;
      setFpIndeterminate(false);
    }
  }

  function cancelFile() {
    fileToken += 1;
    if (whisperWorker) { whisperWorker.terminate(); whisperWorker = null; }
    showFileProgress(false);
    setFpIndeterminate(false);
    processingFile = false;
    el.fileBtn.disabled = false;
    if (IS_DESKTOP || getRecognitionClass()) el.recordBtn.disabled = false;
    showToast("Cancelled");
  }

  // ---------------------------------------------------------------------------
  // Desktop live capture — ONE button captures system audio + microphone
  // ---------------------------------------------------------------------------
  async function startCapture() {
    if (streaming) return;
    setStatus("recording", "Starting…");

    const gathered = [];
    // System (loopback) audio: whatever is playing — meetings, media players, etc.
    try {
      const sys = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      sys.getVideoTracks().forEach((t) => t.stop());
      if (sys.getAudioTracks().length) gathered.push(sys);
      else sys.getTracks().forEach((t) => t.stop());
    } catch (_) {}
    // Microphone: your own voice (echo/noise-suppressed).
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      gathered.push(mic);
    } catch (_) {}

    if (!gathered.length) {
      setStatus("idle", "Ready");
      showToast("Couldn't capture audio. Allow microphone/screen-audio access and try again.");
      return;
    }

    mediaStreams = gathered;
    streaming = true;
    setCaptureUI(true);
    setInterim("Listening… (first line loads the model)");

    const Ctx = window.AudioContext || window.webkitAudioContext;
    streamCtx = new Ctx({ sampleRate: STREAM_SR });
    streamNode = streamCtx.createScriptProcessor(4096, 1, 1);
    streamGain = streamCtx.createGain();
    streamGain.gain.value = 0; // don't play captured audio back

    streamSrcNodes = [];
    for (const s of mediaStreams) {
      const src = streamCtx.createMediaStreamSource(s);
      src.connect(streamNode); // multiple sources sum into the one node
      streamSrcNodes.push(src);
    }

    pcmBuf = []; pcmLen = 0; silentMs = 0; voicedMs = 0;
    segQueue = []; workerBusy = false; lastInterimAt = 0;

    streamNode.onaudioprocess = function (e) {
      if (!streaming) return;
      const input = e.inputBuffer.getChannelData(0);
      const chunk = new Float32Array(input);
      let sum = 0;
      for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
      const rms = Math.sqrt(sum / chunk.length);
      const ms = (chunk.length / STREAM_SR) * 1000;

      pcmBuf.push(chunk);
      pcmLen += chunk.length;
      if (rms < SILENCE_RMS) silentMs += ms;
      else { silentMs = 0; voicedMs += ms; }

      const totalMs = (pcmLen / STREAM_SR) * 1000;
      if ((silentMs >= SILENCE_HOLD_MS && voicedMs >= MIN_SPEECH_MS) || totalMs >= MAX_SEG_MS) {
        flushSegment();
      } else {
        dispatch();
      }
    };

    streamNode.connect(streamGain);
    streamGain.connect(streamCtx.destination);
  }

  function snapshotPcm() {
    const seg = new Float32Array(pcmLen);
    let off = 0;
    for (const c of pcmBuf) { seg.set(c, off); off += c.length; }
    return seg;
  }

  function resultText(result) {
    return (result && (result.text || (result.chunks || []).map((c) => c.text).join(" "))) || "";
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

  async function dispatch() {
    if (workerBusy) return;

    if (segQueue.length) {
      workerBusy = true;
      const seg = segQueue.shift();
      try {
        const result = await transcribeInWorker(seg, whisperLang(el.langSelect.value), function () {}, function () {});
        const txt = resultText(result);
        if (txt.trim()) appendLine(txt);
      } catch (_) {}
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
        const result = await transcribeInWorker(snap, whisperLang(el.langSelect.value), function () {}, function () {});
        const clean = collapseRepeats(resultText(result).trim());
        if (streaming && clean && !segQueue.length) setInterim(clean);
      } catch (_) {}
      workerBusy = false;
      dispatch();
    }
  }

  function stopCapture() {
    if (!streaming) return;
    streaming = false;
    if (streamNode) { streamNode.onaudioprocess = null; try { streamNode.disconnect(); } catch (_) {} }
    for (const src of streamSrcNodes) { try { src.disconnect(); } catch (_) {} }
    if (streamGain) { try { streamGain.disconnect(); } catch (_) {} }
    for (const s of mediaStreams) s.getTracks().forEach((t) => t.stop());
    flushSegment();
    if (streamCtx && streamCtx.close) { try { streamCtx.close(); } catch (_) {} }
    streamCtx = null; streamNode = null; streamGain = null; streamSrcNodes = []; mediaStreams = [];
    setCaptureUI(false);
  }

  // Unified Start/Stop. Desktop mixes system audio + mic via Whisper; the browser
  // uses the Web Speech API on the microphone.
  function toggleCapture() {
    if (IS_DESKTOP) {
      if (streaming) stopCapture(); else startCapture();
    } else {
      if (recording) stopRecording(); else startRecording();
    }
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
      el.recordBtn.disabled = false;
    } else if (!getRecognitionClass()) {
      showUnsupported();
    }

    el.recordBtn.addEventListener("click", toggleCapture);
    el.fileBtn.addEventListener("click", function () {
      if (recording || streaming) { showToast("Stop capturing before transcribing a file."); return; }
      el.fileInput.click();
    });
    el.fileInput.addEventListener("change", function () {
      const file = el.fileInput.files && el.fileInput.files[0];
      el.fileInput.value = "";
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
        if (!el.recordBtn.disabled) toggleCapture();
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
