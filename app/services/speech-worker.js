// Loom writes down speech on this device (0.33.4): a small German Whisper (primeline/whisper-tiny-german-1224,
// 38 M parameters, Apache-2.0; on German test sets it misses about 6 words in 100, the large model on the Mac about
// 3) runs here with Transformers.js, on the graphics chip (WebGPU) where the browser has it, otherwise in
// WebAssembly. Used when the Mac is out of reach (on the go); the Mac writes the same recording down again later,
// precisely (speech.js).
//
// Messages:  { kind: 'state' }                     → { kind: 'state', cached }
//            { kind: 'load' }                      → { kind: 'progress', loaded, total } … { kind: 'ready', device }
//            { kind: 'text', id, pcm, lang }       → { kind: 'text', id, text }   (pcm: Float32Array, 16 kHz mono)
//            any failure                           → { kind: 'error', id, error }
// The model comes from Hugging Face once (about 230 MB) and stays in the browser's cache "transformers-cache".
// For Python readers: like a small worker process with a queue: one request at a time, answered by id.
import { env, pipeline } from '../../vendor/speech/transformers.min.js';

export const MODELS = ['primeline/whisper-tiny-german-1224', 'primeline/whisper-tiny-german'];
env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = new URL('../../vendor/speech/', import.meta.url).href;
env.backends.onnx.wasm.proxy = false;

let asr = null;
let loading = null;
let device = '';

async function hasGpu() {
  try { return !!(self.navigator?.gpu && await self.navigator.gpu.requestAdapter()); } catch { return false; }
}

// is the model already in the cache (nothing to download)?
async function cached() {
  try {
    const c = await caches.open('transformers-cache');
    const keys = await c.keys();
    return MODELS.some((m) => keys.some((k) => k.url.includes(`/${m}/`) && /encoder_model/.test(k.url)));
  } catch { return false; }
}

function load() {
  if (asr) return Promise.resolve(asr);
  if (loading) return loading;
  loading = (async () => {
    const gpu = await hasGpu();
    const files = new Map();
    const progress = (p) => {
      if (p.status !== 'progress' && p.status !== 'done') return;
      files.set(p.file, { loaded: p.loaded || 0, total: p.total || p.loaded || 0 });
      let loaded = 0; let total = 0;
      for (const f of files.values()) { loaded += f.loaded; total += f.total; }
      self.postMessage({ kind: 'progress', loaded, total });
    };
    let last = null;
    for (const model of MODELS) {
      for (const dev of gpu ? ['webgpu', 'wasm'] : ['wasm']) {
        try {
          asr = await pipeline('automatic-speech-recognition', model, { device: dev, dtype: 'fp32', progress_callback: progress });
          device = dev;
          return asr;
        } catch (e) { last = e; }
      }
    }
    loading = null;
    throw last || new Error('no model');
  })();
  return loading;
}

self.onmessage = async (e) => {
  const m = e.data || {};
  try {
    if (m.kind === 'state') { self.postMessage({ kind: 'state', cached: await cached(), ready: !!asr }); return; }
    if (m.kind === 'load') { await load(); self.postMessage({ kind: 'ready', device }); return; }
    if (m.kind === 'text') {
      const run = await load();
      const out = await run(m.pcm, { language: m.lang === 'en' ? 'english' : 'german', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5, return_timestamps: false });
      const text = Array.isArray(out) ? out.map((x) => x.text).join(' ') : out?.text || '';
      self.postMessage({ kind: 'text', id: m.id, text: String(text).trim() });
    }
  } catch (err) {
    self.postMessage({ kind: 'error', id: m.id, error: String(err?.message || err).slice(0, 300) });
  }
};
