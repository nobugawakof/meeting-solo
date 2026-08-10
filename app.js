/* Meeting Solo — Live Captions & Transcript
 *
 * Real-time speech-to-text using the browser's Web Speech API.
 * Fixes the three flaws of Windows Live Captions:
 *   1. Unlimited transcript — every finalized line is kept.
 *   2. Copyable & exportable — copy to clipboard or download as a file.
 *   3. Persistent — auto-saved to localStorage, survives closing the app.
 */

(function () {
  "use strict";

  const STORAGE_KEY = "meeting-solo.transcript.v1";
  const PREFS_KEY = "meeting-solo.prefs.v1";

  // --- DOM references ---
  const el = {
    recordBtn: document.getElementById("recordBtn"),
    recordBtnLabel: document.getElementById("recordBtnLabel"),
    langSelect: document.getElementById("langSelect"),
    timestampToggle: document.getElementById("timestampToggle"),
    copyBtn: document.getElementById("copyBtn"),
    exportBtn: document.getElementById("exportBtn"),
    clearBtn: document.getElementById("clearBtn"),
    liveCaption: document.getElementById("liveCaption"),
    transcript: document.getElementById("transcript"),
    stats: document.getElementById("stats"),
    status: document.getElementById("status"),
    statusDot: document.getElementById("statusDot"),
    statusText: document.getElementById("statusText"),
    unsupported: document.getElementById("unsupported"),
    toast: document.getElementById("toast"),
  };

  // --- State ---
  /** @type {{time:string, text:string}[]} */
  let lines = [];
  let recognition = null;
  let recording = false;
  let stoppedByUser = false;
  let restartTimer = null;

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) lines = JSON.parse(raw) || [];
    } catch (_) { lines = []; }

    try {
      const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
      if (prefs.lang) el.langSelect.value = prefs.lang;
      if (typeof prefs.timestamps === "boolean") el.timestampToggle.checked = prefs.timestamps;
    } catch (_) { /* ignore */ }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch (_) { /* storage may be full or blocked */ }
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        lang: el.langSelect.value,
        timestamps: el.timestampToggle.checked,
      }));
    } catch (_) { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function nowLabel() {
    const d = new Date();
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    const s = String(d.getSeconds()).padStart(2, "0");
    return `${h}:${m}:${s}`;
  }

  function renderTranscript() {
    el.transcript.innerHTML = "";
    const showTime = el.timestampToggle.checked;
    const frag = document.createDocumentFragment();

    for (const line of lines) {
      const row = document.createElement("div");
      row.className = "line";

      if (showTime && line.time) {
        const t = document.createElement("span");
        t.className = "line-time";
        t.textContent = line.time;
        row.appendChild(t);
      }

      const txt = document.createElement("span");
      txt.className = "line-text";
      txt.textContent = line.text;
      row.appendChild(txt);

      frag.appendChild(row);
    }
    el.transcript.appendChild(frag);
    el.transcript.scrollTop = el.transcript.scrollHeight;
    updateStats();
    updateButtonStates();
  }

  function appendLine(text) {
    const clean = text.trim();
    if (!clean) return;
    lines.push({ time: nowLabel(), text: clean });
    renderTranscript();
    saveState();
  }

  function countWords() {
    let words = 0;
    for (const line of lines) {
      const t = line.text.trim();
      if (!t) continue;
      // CJK characters count individually; other scripts count by whitespace.
      const cjk = (t.match(/[一-鿿㐀-䶿]/g) || []).length;
      const nonCjk = t.replace(/[一-鿿㐀-䶿]/g, " ").trim();
      const latin = nonCjk ? nonCjk.split(/\s+/).filter(Boolean).length : 0;
      words += cjk + latin;
    }
    return words;
  }

  function updateStats() {
    const n = lines.length;
    el.stats.textContent = `${n} line${n === 1 ? "" : "s"} · ${countWords()} words`;
  }

  function updateButtonStates() {
    const hasContent = lines.length > 0;
    el.copyBtn.disabled = !hasContent;
    el.exportBtn.disabled = !hasContent;
    el.clearBtn.disabled = !hasContent;
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

    r.onstart = function () {
      setRecordingUI(true);
    };

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
        // Benign — recognizer will end and be restarted by onend.
        setStatus("recording", "Listening… (no speech yet)");
      } else if (err === "audio-capture") {
        stoppedByUser = true;
        showToast("No microphone found. Check your audio device.");
      } else if (err !== "aborted") {
        setStatus("recording", "Reconnecting…");
      }
    };

    r.onend = function () {
      // Web Speech API stops on its own periodically; restart while recording.
      if (recording && !stoppedByUser) {
        clearTimeout(restartTimer);
        restartTimer = setTimeout(() => {
          try { r.start(); } catch (_) { /* already started */ }
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
    } catch (err) {
      showToast("Could not start recording. Try again.");
      setRecordingUI(false);
    }
  }

  function stopRecording() {
    stoppedByUser = true;
    recording = false;
    clearTimeout(restartTimer);
    if (recognition) {
      try { recognition.stop(); } catch (_) { /* ignore */ }
    }
    setRecordingUI(false);
  }

  function toggleRecording() {
    if (recording) stopRecording();
    else startRecording();
  }

  // ---------------------------------------------------------------------------
  // Export / copy / clear
  // ---------------------------------------------------------------------------
  function transcriptToText() {
    const showTime = el.timestampToggle.checked;
    return lines
      .map((l) => (showTime && l.time ? `[${l.time}] ${l.text}` : l.text))
      .join("\n");
  }

  async function copyTranscript() {
    const text = transcriptToText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast("Transcript copied to clipboard");
    } catch (_) {
      // Fallback for older browsers / insecure contexts.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        showToast("Transcript copied to clipboard");
      } catch (e) {
        showToast("Copy failed — select the text manually.");
      }
      document.body.removeChild(ta);
    }
  }

  function exportTranscript() {
    const text = transcriptToText();
    if (!text) return;
    const stamp = new Date()
      .toISOString()
      .slice(0, 16)
      .replace("T", "_")
      .replace(":", "-");
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
    // Force reflow so the transition runs.
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

    if (!getRecognitionClass()) {
      showUnsupported();
    }

    el.recordBtn.addEventListener("click", toggleRecording);
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

    // Keyboard shortcut: Ctrl/Cmd + Enter toggles recording.
    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (!el.recordBtn.disabled) toggleRecording();
      }
    });

    // Warn before leaving while recording.
    window.addEventListener("beforeunload", function (e) {
      if (recording) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
