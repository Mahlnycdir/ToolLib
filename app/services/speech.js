// Loom listens (0.33.4, ENTE: "ein Speech-to-Text … wie eine Sprachnachricht", "nicht meine Tastatur", "richtig,
// richtig gut"). A tap on the microphone records like a voice message; a second tap ends it. Then, in this order:
//
//   1. The Mac writes it down: the Mac helper with a large German Whisper (whisper-large-v3-turbo-german, MLX, on the
//      Mac only; about 3 words in 100 wrong on German test sets). Loom gives it words from your knowledge (titles of
//      cards, the project you are in), so "chirale Anomalie" stays "chirale Anomalie".
//   2. Out of reach of the Mac (on the go): a small German Whisper on this device (speech-worker.js, loaded once
//      after asking) writes it down at once, a little less exact; the recording waits on this device and the Mac
//      writes it down again as soon as it can be reached; the precise text then replaces the quick one.
//   3. Neither: the recording waits for the Mac as a voice message and becomes a note when written down.
//
// Nothing goes to any server but your own Mac. Recordings wait in IndexedDB on this device (database toollib-speech),
// at most two weeks, and are gone once written down.
//
// For Python readers: record() is like sounddevice.rec(); writeDown() tries the engines in order; the queue is a
// small persistent list (like a sqlite table) that drain() works off when the Mac answers.
import { loadPref, savePref } from './prefs.js';
import { getLang } from '../i18n/i18n.js';
import { helperFetch, helperReady, hasHelper, researchSettings } from './research.js';
import { allNodes, nodeByPath } from './search.js';

export const RATE = 16000;
export const MAX_SECONDS = 300;

// ------------------------------------------------------------------ the language Loom listens in
// Its own, not the language of the surface (0.33.2): ENTE reads Loom in English and speaks German. First the pref,
// then the languages of the device (German if it has German at all), then the surface.
export const SPEECH_LANGS = ['de-DE', 'en-US'];
export function speechLang() {
  const v = loadPref('loom.speechLang', '');
  if (SPEECH_LANGS.includes(v)) return v;
  const device = (navigator.languages?.length ? navigator.languages : [navigator.language || '']).map((x) => String(x).toLowerCase());
  if (device.some((x) => x.startsWith('de'))) return 'de-DE';
  if (device.some((x) => x.startsWith('en'))) return 'en-US';
  return getLang() === 'de' ? 'de-DE' : 'en-US';
}
export const setSpeechLang = (v) => { if (SPEECH_LANGS.includes(v)) savePref('loom.speechLang', v); };
// 0.33.7 (ENTE: "ich will mir das aussuchen und genau wissen, welches Model gerade da ist"): who writes down —
// 'auto' (the Mac when it is in reach, else this device), 'mac' (only the Mac; on the go it waits for it) or 'here'
// (only the small model on this device, even when the Mac is in reach)
export const SPEECH_ENGINES = ['auto', 'mac', 'here'];
export const MODEL_NAMES = { mac: 'Whisper large-v3-turbo · Deutsch · 1,6 GB', here: 'Whisper tiny · Deutsch · 230 MB' };
export function speechEngine() { const v = loadPref('loom.speechEngine', 'auto'); return SPEECH_ENGINES.includes(v) ? v : 'auto'; }
export const setSpeechEngine = (v) => { if (SPEECH_ENGINES.includes(v)) savePref('loom.speechEngine', v); };

// ------------------------------------------------------------------ recording
// → { seconds(), stop() → Float32Array (16 kHz mono), cancel(), and for writing along while you speak (0.33.5):
//     rate, samples(), silence() (seconds since your voice was last heard), voiced(from, to), slice(from, to) }.
// onLevel(0…1) about ten times a second (the wave). Your voice is told from silence by its loudness against the
// quietest the room has been (like a simple noise gate).
export async function record({ onLevel } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('no microphone'), { name: 'NotSupportedError' });
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  try { await ctx.resume(); } catch { /* already running */ }
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const rate = ctx.sampleRate;
  const chunks = [];   // [start, Float32Array]
  const spans = [];    // [from, to]: where your voice was heard
  let n = 0;
  let floor = null;
  let lastVoice = -1;
  proc.onaudioprocess = (e) => {
    const d = e.inputBuffer.getChannelData(0);
    chunks.push([n, new Float32Array(d)]);
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += d[i] * d[i];
    const rms = Math.sqrt(s / (d.length / 4));
    floor = floor == null ? rms : rms < floor ? rms : floor * 0.995 + rms * 0.005;
    if (rms > Math.max(0.012, floor * 3)) {
      const last = spans[spans.length - 1];
      if (last && last[1] >= n) last[1] = n + d.length; else spans.push([n, n + d.length]);
      lastVoice = n + d.length;
    }
    n += d.length;
    if (onLevel) onLevel(Math.min(1, rms * 5));
  };
  src.connect(proc);
  proc.connect(ctx.destination);   // the processor only runs when it leads somewhere; it writes silence
  const started = Date.now();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try { proc.disconnect(); src.disconnect(); } catch { /* gone */ }
    for (const tr of stream.getTracks()) tr.stop();
    try { ctx.close(); } catch { /* gone */ }
  };
  const copy = (from, to) => {
    const out = new Float32Array(Math.max(0, to - from));
    for (const [at, c] of chunks) {
      if (at + c.length <= from || at >= to) continue;
      const a = Math.max(from, at); const b = Math.min(to, at + c.length);
      out.set(c.subarray(a - at, b - at), a - from);
    }
    return out;
  };
  return {
    rate,
    seconds: () => (Date.now() - started) / 1000,
    samples: () => n,
    silence: () => (n - Math.max(0, lastVoice)) / rate,
    voiced: (from, to = n) => spans.some(([a, b]) => b > from && a < to),
    slice: (from, to = n) => resample(copy(from, to), rate),
    async stop() { close(); return resample(copy(0, n), rate); },
    cancel: close,
  };
}

async function resample(data, rate) {
  if (!data.length || rate === RATE) return data;
  try {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const off = new OAC(1, Math.ceil((data.length * RATE) / rate), RATE);
    const buf = off.createBuffer(1, data.length, rate);
    buf.getChannelData(0).set(data);
    const s = off.createBufferSource();
    s.buffer = buf;
    s.connect(off.destination);
    s.start();
    return (await off.startRendering()).getChannelData(0).slice();
  } catch {
    // by hand (linear), should the browser refuse
    const out = new Float32Array(Math.floor((data.length * RATE) / rate));
    const k = rate / RATE;
    for (let i = 0; i < out.length; i++) { const x = i * k; const j = Math.floor(x); out[i] = data[j] + ((data[j + 1] ?? data[j]) - data[j]) * (x - j); }
    return out;
  }
}

// nothing to write down: too short or only silence
export function isSilent(pcm) {
  if (!pcm || pcm.length < RATE * 0.4) return true;
  let s = 0;
  for (let i = 0; i < pcm.length; i += 4) s += pcm[i] * pcm[i];
  return Math.sqrt(s / (pcm.length / 4)) < 0.003;
}

// 16-bit WAV, the way the Mac helper reads it (Python's wave module, no ffmpeg needed)
export function wavOf(pcm, rate = RATE) {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return buf;
}
export function pcmOf(wav) {
  const v = new DataView(wav);
  const n = (wav.byteLength - 44) >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = v.getInt16(44 + i * 2, true) / 0x7fff;
  return out;
}

// ------------------------------------------------------------------ your words
// Titles from your knowledge as a hint for the model (Whisper's "prompt"): the project you are in and what hangs on it
// first, then cards, formulas and the rest (no notes, no papers). At most about 600 characters.
export function vocabulary({ project = '', lang = 'de', max = 600 } = {}) {
  const out = [];
  const seen = new Set();
  const add = (s) => {
    const w = String(s || '').replace(/\s+/g, ' ').replace(/[,;]+/g, ' ').trim();
    const k = w.toLowerCase();
    if (!w || w.length > 48 || seen.has(k)) return;
    seen.add(k);
    out.push(w);
  };
  const titles = (d) => { if (lang === 'de' && d.title_de) add(d.title_de); add(d.title); for (const a of (d.aliases || []).slice(0, 2)) add(a); };
  for (const right of Object.values(myWords()).slice(-40)) add(right);
  const p = project ? nodeByPath(project) : null;
  if (p) {
    add(p.title_de || p.title);
    for (const slug of [...(p.links || []), ...(p.pins || [])].slice(0, 60)) { const d = allNodes().find((x) => x.slug === slug); if (d && d.type !== 'clip') titles(d); }
  }
  const rank = { formula: 0, card: 0, concept: 0, convention: 1, project: 1, path: 2, snippet: 3 };
  const rest = allNodes().filter((d) => !d.conflict && d.type !== 'note' && d.type !== 'clip' && d.type !== 'page')
    .sort((a, b) => (rank[a.type] ?? 2) - (rank[b.type] ?? 2));
  for (const d of rest) { titles(d); for (const tg of (d.tags || []).slice(0, 2)) add(tg); if (out.join(', ').length > max) break; }
  let text = '';
  for (const w of out) { if (text.length + w.length + 2 > max) break; text += (text ? ', ' : '') + w; }
  return text;
}

// Whisper, given silence or noise, sometimes "hears" the end of a TV programme; those lines are dropped.
const PHANTOMS = [/untertitel(ung)?( im auftrag)? (des|der) (zdf|ard|wdr|swr|ndr|br|amara\S*)[^.]*\.?/gi, /untertitel von \S+[^.]*\.?/gi,
  /vielen dank f(ü|ue)r'?s? zuschauen[.!]?/gi, /(copyright|©) (wdr|swr|zdf|ard)\s*\d*/gi, /thanks? (you )?for watching[.!]?/gi, /\[musik\]|\(musik\)|\*musik\*/gi];
// fillers go, everything else stays as said ("äh", "ähm"; no lookbehind: Safari 15)
const FILLERS = /(^|[\s,;])(?:äh|ähm|öhm|ehm|hm+)[,.]?(?=\s|$)/gi;
export function clean(text) {
  let s = String(text || '');
  for (const r of PHANTOMS) s = s.replace(r, ' ');
  s = s.replace(FILLERS, '$1').replace(FILLERS, '$1');
  return applyWords(s.replace(/\s+/g, ' ').replace(/\s+([,.;!?])/g, '$1').trim());
}

// ------------------------------------------------------------------ your dictionary
// What you corrected in a spoken text before sending it (0.33.4): "Normal" → "Anomalie". From then on Loom puts it
// right by itself, and the right word goes to Whisper as a hint. Pref loom.words { wrong (lower case): right }.
const WORDS = 'loom.words';
export const myWords = () => { const v = loadPref(WORDS, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
const tokens = (s) => String(s || '').split(/\s+/).filter(Boolean);
const bare = (w) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
export function applyWords(text) {
  const words = myWords();
  const keys = Object.keys(words).sort((a, b) => b.length - a.length);
  if (!keys.length) return text;
  let s = ` ${text} `;
  for (const k of keys) {
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(`(^|[\\s„"(])${esc}(?=[\\s,.;:!?“")]|$)`, 'giu'), (m, pre) => pre + words[k]);
  }
  return s.trim();
}
// spoken → sent: the words you replaced (spans of up to three words on both sides), via the longest common
// subsequence of the two word lists (like difflib.SequenceMatcher)
export function learnWords(spoken, sent) {
  const a = tokens(spoken); const b = tokens(sent);
  if (!a.length || !b.length || a.join(' ') === b.join(' ')) return 0;
  const n = a.length; const m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = bare(a[i]) === bare(b[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  // a text you rewrote rather than corrected teaches nothing
  if (L[0][0] < Math.max(n, m) * 0.5) return 0;
  const found = [];
  let i = 0; let j = 0; let gi = 0; let gj = 0;
  // one word alone keeps a neighbour as context ("chirale normal" → "chirale Anomalie"), so a word that is right
  // elsewhere ("normal") is not changed everywhere
  const flush = () => {
    if (i - gi < 1 || j - gj < 1 || i - gi > 3 || j - gj > 3) return;
    let wa = a.slice(gi, i); let wb = b.slice(gj, j);
    if (wa.length === 1) {
      if (gi > 0) { wa = [a[gi - 1], ...wa]; wb = [b[gj - 1], ...wb]; } else if (i < n) { wa = [...wa, a[i]]; wb = [...wb, b[j]]; } else return;
    }
    const wrong = wa.map(bare).filter(Boolean).join(' ');
    const right = wb.join(' ').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (wrong && right && wrong !== right.toLowerCase()) found.push([wrong, right]);
  };
  while (i < n && j < m) {
    if (bare(a[i]) === bare(b[j])) { flush(); i += 1; j += 1; gi = i; gj = j; continue; }
    if (L[i + 1][j] >= L[i][j + 1]) i += 1; else j += 1;
  }
  i = n; j = m; flush();
  if (!found.length) return 0;
  const words = myWords();
  for (const [w, r] of found) words[w] = r;
  savePref(WORDS, Object.fromEntries(Object.entries(words).slice(-300)));
  return found.length;
}
export function forgetWord(wrong) { const w = myWords(); delete w[wrong]; savePref(WORDS, w); }

// ------------------------------------------------------------------ the engines
// Tests (and nothing else) may put their own engines in: setEngines({ mac: async (pcm, o) => text, here: … }).
const engines = { mac: null, here: null, hereState: null, loadHere: null };
export function setEngines(e) { Object.assign(engines, e); macCache = null; }

let macCache = null;   // { ok, reason, at }
// Can the Mac write it down right now? { ok, reason: 'no-helper' | 'unreachable' | 'not-installed' }
export async function macState({ fresh = false } = {}) {
  if (engines.mac) return { ok: true };
  const s = researchSettings();
  if (!hasHelper(s)) return { ok: false, reason: 'no-helper' };
  if (!fresh && macCache && Date.now() - macCache.at < 60000) return macCache;
  let r;
  if (!(await helperReady(s, { fresh }))) r = { ok: false, reason: 'unreachable' };
  else {
    try {
      const j = await (await helperFetch('/speech/state', { settings: s })).json();
      r = j.installed ? { ok: true, loaded: !!j.loaded } : { ok: false, reason: 'not-installed' };
    } catch { r = { ok: false, reason: 'not-installed' }; }
  }
  macCache = { ...r, at: Date.now() };
  return r;
}
async function onMac(pcm, { lang, prompt, quick = false }) {
  if (engines.mac) return engines.mac(pcm, { lang, prompt, quick });
  // quick (0.33.7): a preview while you still speak, one try without the slower second and third passes
  const q = `lang=${encodeURIComponent(lang)}&prompt=${encodeURIComponent(String(prompt || '').slice(0, 800))}${quick ? '&quick=1' : ''}`;
  const res = await helperFetch(`/speech/text?${q}`, { method: 'POST', body: wavOf(pcm), type: 'audio/wav' });
  const j = await res.json();
  return String(j.text || '');
}

// this device: the worker with the small model
let worker = null;
let seq = 0;
const waitingFor = new Map();
let progressFn = null;
function speechWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./speech-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const m = e.data || {};
    if (m.kind === 'progress') { progressFn?.(m.total ? m.loaded / m.total : 0, m.total); return; }
    const key = m.kind === 'text' || (m.kind === 'error' && m.id) ? m.id : m.kind === 'error' ? 'load' : m.kind === 'ready' ? 'load' : m.kind;
    const w = waitingFor.get(key);
    if (!w) return;
    waitingFor.delete(key);
    if (m.kind === 'error') w.reject(new Error(m.error)); else w.resolve(m);
  };
  worker.onerror = (e) => { for (const w of waitingFor.values()) w.reject(new Error(e.message || 'worker')); waitingFor.clear(); worker = null; };
  return worker;
}
const ask = (key, msg) => new Promise((resolve, reject) => { waitingFor.set(key, { resolve, reject }); speechWorker().postMessage(msg); });

// { cached, ready }: is the small model on this device?
export async function hereState() {
  if (engines.hereState) return engines.hereState();
  try { return await Promise.race([ask('state', { kind: 'state' }), new Promise((r) => setTimeout(() => r({ cached: false, ready: false }), 4000))]); } catch { return { cached: false, ready: false }; }
}
// fetch the small model (about 230 MB, once); onProgress(0…1, bytes)
export async function loadHere(onProgress) {
  if (engines.loadHere) return engines.loadHere(onProgress);
  progressFn = onProgress;
  try { return await ask('load', { kind: 'load' }); } finally { progressFn = null; }
}
// 0.33.7: take the small model off this device again (the browser's cache of it)
export async function forgetHere() {
  try { worker?.terminate(); } catch { /* gone already */ }
  worker = null;
  waitingFor.clear();
  try { await caches.delete('transformers-cache'); } catch (e) { console.warn('speech: forget', e); }
}
// 0.33.7: the model wakes while you start speaking, so the first words do not wait for it to load (Mac: a few
// seconds the first time after a pause of five minutes; device: into memory from its cache)
export async function warmUp(engine) {
  try {
    if (engine === 'mac' && !engines.mac) await helperFetch('/speech/warm', { method: 'POST' });
    else if (engine === 'here' && !engines.here) { const hs = await hereState(); if (hs.cached && !hs.ready) await ask('load', { kind: 'load' }); }
  } catch { /* an older Mac helper has no /speech/warm: then it loads with the first piece */ }
}
// which one writes down right now: 'mac', 'here' or '' (nobody: it waits for the Mac or is not set up)
export async function activeEngine() {
  const want = speechEngine();
  if (want !== 'here' && (await macState()).ok) return 'mac';
  if (want === 'mac') return '';
  const hs = await hereState();
  if (hs.cached || hs.ready) return 'here';
  return '';
}
async function onHere(pcm, { lang }) {
  if (engines.here) return engines.here(pcm, { lang });
  const id = `t${++seq}`;
  const m = await ask(id, { kind: 'text', id, pcm, lang });
  return m.text || '';
}

// ------------------------------------------------------------------ writing it down
// → { text, precise, later }: precise = from the Mac; later = the Mac should write it down again (or at all).
// mayLoad() is asked before the small model is fetched the first time (it costs about 230 MB).
export async function writeDown(pcm, { lang = speechLang().slice(0, 2), prompt = '', mayLoad = null } = {}) {
  const want = speechEngine();
  const mac = want === 'here' ? { ok: false } : await macState();
  if (mac.ok) {
    try { return { text: clean(await onMac(pcm, { lang, prompt })), precise: true, later: false }; } catch (e) { console.warn('speech: Mac', e); macCache = null; }
  }
  const canLater = engines.mac ? true : hasHelper();
  if (want === 'mac') return { text: '', precise: false, later: canLater };
  const here = await hereState();
  if (here.cached || here.ready || (mayLoad && (await mayLoad()))) {
    try { return { text: clean(await onHere(pcm, { lang })), precise: false, later: canLater }; } catch (e) { console.warn('speech: here', e); }
  }
  return { text: '', precise: false, later: canLater };
}

// ------------------------------------------------------------------ writing along while you speak (0.33.5)
// ENTE: "Text in Echtzeit, dann sieht man, wo man ist". The recording is cut where you pause (0.7 s); each piece is
// written down once you paused (final) and, while you still speak, every second or so as it stands (shown, then
// replaced). Each piece gets your words and the end of what you said before as a hint, so the pieces join up.
// "warte" at the end of a piece holds: the text keeps it out, and nothing is sent until you speak again.
// For Python readers: a small loop (every 0.3 s) over a growing buffer, one request at a time.
export const AUTO_SECONDS = 10;
const WAIT_WORD = { de: /(^|[\s,.;:!?…–-])warte(\s+mal)?[\s.,!?…]*$/i, en: /(^|[\s,.;:!?…–-])(wait|hold on)[\s.,!?…]*$/i };
export function waitWord(text, lang = 'de') {
  const m = String(text || '').match(WAIT_WORD[lang] || WAIT_WORD.de);
  if (!m) return { text: String(text || ''), hold: false };
  return { text: text.slice(0, m.index + m[1].length).replace(/[\s,;:–-]+$/, '').trim(), hold: true };
}
// which engine writes along: 'mac', 'here' or '' (none: the recording is written down when it ends)
export async function liveEngine() { return activeEngine(); }
export function liveWriter(rec, { engine, lang = speechLang().slice(0, 2), prompt = '', onText = () => {} }) {
  const R = rec.rate;
  const run = engine === 'mac' ? onMac : onHere;
  const finals = [];
  let seg = 0;
  let interim = '';
  let busy = false;
  let broken = false;
  let hold = false;
  let lastInterim = 0;
  const hint = () => { const tail = finals.join(' ').slice(-240); return (tail ? `${prompt}${prompt ? '. ' : ''}${tail}` : prompt).slice(-800); };
  const show = () => onText({ text: [...finals, interim].filter(Boolean).join(' '), hold });
  const write = async (from, to, quick = false) => clean(await run(await rec.slice(from, to), { lang, prompt: hint(), quick }));
  async function finalize(cut) {
    const from = seg;
    seg = cut;
    if (!rec.voiced(from, cut) || cut - from < R * 0.3) { interim = ''; show(); return; }
    const w = waitWord(await write(from, cut), lang);
    if (w.hold) hold = true; else if (w.text) hold = false;
    if (w.text) finals.push(w.text);
    interim = '';
    show();
  }
  async function step() {
    if (busy || broken) return;
    busy = true;
    try {
      const now = rec.samples();
      const quiet = rec.silence();
      const open = (now - seg) / R;
      const voiced = rec.voiced(seg, now);
      if (voiced && (quiet >= 0.7 || open >= 25)) await finalize(quiet >= 0.7 ? Math.max(seg, now - Math.floor((quiet - 0.25) * R)) : now);
      else if (voiced && open >= 1 && Date.now() - lastInterim > 900) { lastInterim = Date.now(); interim = (await write(seg, now, true)).replace(WAIT_WORD[lang] || WAIT_WORD.de, '$1').trim(); show(); }
      else if (!voiced && open > 2) seg = now - Math.floor(0.3 * R);
    } catch (e) { console.warn('speech: live', e); broken = true; } finally { busy = false; }
  }
  const timer = setInterval(step, 300);
  return {
    engine,
    get hold() { return hold; },
    get said() { return finals.length > 0; },
    get busy() { return busy; },
    get broken() { return broken; },
    async finish() {
      clearInterval(timer);
      while (busy) await new Promise((r) => setTimeout(r, 40));
      if (!broken) { try { await finalize(rec.samples()); } catch (e) { console.warn('speech: live end', e); broken = true; } }
      return { text: finals.join(' '), broken };
    },
    cancel() { clearInterval(timer); broken = true; },
  };
}

// ------------------------------------------------------------------ recordings that wait for the Mac
// { id, at, wav, lang, prompt, rough, msg, note, project, seconds } in IndexedDB.
const DB = 'toollib-speech';
const KEEP_MS = 14 * 24 * 3600 * 1000;
function db() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('waiting', { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('waiting', mode);
    const out = fn(t.objectStore('waiting'));
    t.oncomplete = () => { d.close(); resolve(out?.result ?? out); };
    t.onerror = () => { d.close(); reject(t.error); };
  });
}
export async function keepForMac(item) {
  const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await tx('readwrite', (s) => s.put({ id, at: Date.now(), ...item }));
  notify();
  return id;
}
export async function waiting() {
  try {
    const all = await tx('readonly', (s) => s.getAll());
    return (all || []).sort((a, b) => a.at - b.at);
  } catch { return []; }
}
const forget = (id) => tx('readwrite', (s) => s.delete(id)).catch(() => {});
const listeners = new Set();
export function onWaitingChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify() { for (const f of listeners) { try { f(); } catch { /* one listener does not stop the others */ } } }

// Works off the recordings that wait, oldest first, while the Mac answers. apply(item, text) puts the precise text in
// place (Loom's conversation does that, loom-talk.js). → how many were written down.
let draining = null;
export function drain(apply) {
  if (draining) return draining;
  draining = (async () => {
    let done = 0;
    try {
      const list = await waiting();
      if (!list.length) return 0;
      for (const item of list) {
        if (Date.now() - item.at > KEEP_MS) { await forget(item.id); continue; }
        const mac = await macState({ fresh: done === 0 });
        if (!mac.ok) break;
        let text;
        try { text = clean(await onMac(pcmOf(item.wav), { lang: item.lang, prompt: item.prompt })); } catch (e) { console.warn('speech: drain', e); macCache = null; break; }
        try { await apply(item, text); } catch (e) { console.warn('speech: apply', e); }
        await forget(item.id);
        done += 1;
      }
    } finally { draining = null; notify(); }
    return done;
  })();
  return draining;
}
