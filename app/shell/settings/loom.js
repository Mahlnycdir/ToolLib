// Settings › Loom (0.32.0): what Loom, the second voice, may do. The conversation itself comes in 0.33; the choices
// are kept already, so they are there when it arrives:
//   loom.suggest   'quiet' | 'more' | 'off'   how many suggestions (each one says why it comes)
//   loom.attach    true | false               finds join the chapter you came from when you surface
//   loom.model     'none'                     where Loom's sentences come from; 'none' = only your knowledge and your
//                                             research, with sources. A model is one more value here later (decided 16.11.:
//                                             first without a language model, easy to add afterwards).
import { h } from '../../services/ui.js';
import { t } from '../../i18n/i18n.js';
import { loadPref, savePref } from '../../services/prefs.js';
import { card, check } from './parts.js';
import { SPEECH_LANGS, SPEECH_ENGINES, MODEL_NAMES, speechLang, setSpeechLang, speechEngine, setSpeechEngine, activeEngine, forgetHere, macState, hereState, loadHere, waiting, onWaitingChange } from '../../services/speech.js';

export const LOOM_SUGGEST = ['quiet', 'more', 'off'];
export const LOOM_MODELS = ['none'];
export const loomSuggest = () => { const v = loadPref('loom.suggest', 'quiet'); return LOOM_SUGGEST.includes(v) ? v : 'quiet'; };
export const loomModel = () => { const v = loadPref('loom.model', 'none'); return LOOM_MODELS.includes(v) ? v : 'none'; };

const row = (label, hint, control) => h('div', { class: 'loom-row' }, h('div', {}, h('b', { text: label }), hint ? h('p', { class: 'muted', text: hint }) : null), control);

export function loomTalkCard() {
  const listen = h('span', { class: 'chip muted', text: t('settings.loom.listen.value') });
  const seg = h('div', { class: 'segmented small', role: 'group', 'aria-label': t('settings.loom.suggest') });
  const draw = () => {
    const now = loomSuggest();
    seg.replaceChildren(...LOOM_SUGGEST.map((v) => h('button', {
      type: 'button', class: now === v ? 'on' : '', 'aria-pressed': String(now === v), dataset: { suggest: v }, text: t(`settings.loom.suggest.${v}`),
      onclick: () => { savePref('loom.suggest', v); draw(); },
    })));
  };
  draw();
  return h('section', { class: 'card', id: 'settings-loom' }, h('h2', { text: t('settings.loom.talk') }),
    row(t('settings.loom.listen'), t('settings.loom.listen.hint'), listen),
    row(t('settings.loom.suggest'), t('settings.loom.suggest.hint'), seg),
    check('loom-attach', 'loom.attach', t('settings.loom.attach'), t('settings.loom.attach.hint'), true));
}

export function loomModelCard() {
  const select = h('select', { class: 'field', id: 'loom-model', 'aria-label': t('settings.loom.model') },
    LOOM_MODELS.map((v) => h('option', { value: v, selected: loomModel() === v ? true : null, text: t(`settings.loom.model.${v}`) })));
  select.addEventListener('change', () => savePref('loom.model', select.value));
  return card(t('settings.loom.model'), h('p', { class: 'muted', text: t('settings.loom.model.hint') }), select);
}

// Speaking (0.33.4): who writes down what you say, the small model on this device, what waits for the Mac.
export function loomSpeechCard() {
  const langSeg = h('div', { class: 'segmented small', role: 'group', 'aria-label': t('settings.loom.speech.lang') });
  const drawLang = () => {
    const now = speechLang();
    langSeg.replaceChildren(...SPEECH_LANGS.map((v) => h('button', { type: 'button', class: now === v ? 'on' : '', 'aria-pressed': String(now === v), dataset: { lang: v }, text: v.slice(0, 2).toUpperCase(), onclick: () => { setSpeechLang(v); drawLang(); } })));
  };
  drawLang();
  // 0.33.7: who writes down (your choice), each model with its name and state, and who does it right now
  const engineSeg = h('div', { class: 'segmented small', role: 'group', 'aria-label': t('settings.loom.speech.engine') });
  const drawEngine = () => {
    const now = speechEngine();
    engineSeg.replaceChildren(...SPEECH_ENGINES.map((v) => h('button', { type: 'button', class: now === v ? 'on' : '', 'aria-pressed': String(now === v), dataset: { engine: v }, text: t(`settings.loom.speech.engine.${v}`), onclick: () => { setSpeechEngine(v); drawEngine(); draw(); } })));
  };
  drawEngine();
  const active = h('span', { class: 'chip speech-active', id: 'speech-active', text: '…' });
  const forget = h('button', { type: 'button', class: 'btn small ghost', id: 'speech-forget', hidden: true, text: t('settings.loom.speech.here.remove') });
  const mac = h('span', { class: 'chip muted', id: 'speech-mac', text: '…' });
  const here = h('span', { class: 'chip muted', id: 'speech-here', text: '…' });
  const load = h('button', { type: 'button', class: 'btn small', id: 'speech-load', hidden: true, text: t('settings.loom.speech.here.load') });
  const wait = h('span', { class: 'chip muted', id: 'speech-waiting', text: '…' });
  const now = h('button', { type: 'button', class: 'btn small', id: 'speech-now', hidden: true, text: t('settings.loom.speech.waiting.now') });
  const draw = async () => {
    const m = await macState({ fresh: true });
    mac.textContent = t(m.ok ? (m.loaded ? 'settings.loom.speech.mac.awake' : 'settings.loom.speech.mac.asleep') : `settings.loom.speech.mac.${m.reason}`);
    mac.classList.toggle('ok', !!m.ok);
    const hs = await hereState();
    here.textContent = t(hs.cached || hs.ready ? 'settings.loom.speech.here.cached' : 'settings.loom.speech.here.none');
    here.classList.toggle('ok', !!(hs.cached || hs.ready));
    load.hidden = !!(hs.cached || hs.ready);
    forget.hidden = !load.hidden;
    const a = await activeEngine();
    active.textContent = a ? t(`settings.loom.speech.active.${a}`, { model: MODEL_NAMES[a] }) : t('settings.loom.speech.active.none');
    active.classList.toggle('ok', !!a);
    const list = await waiting();
    wait.textContent = list.length ? t('settings.loom.speech.waiting.n', { n: list.length }) : t('settings.loom.speech.waiting.none');
    now.hidden = !list.length || !m.ok;
  };
  load.addEventListener('click', async () => {
    load.disabled = true;
    try { await loadHere((share) => { here.textContent = t('settings.loom.speech.here.loading', { n: Math.round((share || 0) * 100) }); }); } catch (e) { here.textContent = t('settings.loom.speech.here.failed'); console.warn(e); }
    load.disabled = false;
    draw();
  });
  forget.addEventListener('click', async () => { forget.disabled = true; await forgetHere(); here.textContent = t('settings.loom.speech.here.removed'); forget.disabled = false; draw(); });
  now.addEventListener('click', async () => {
    now.disabled = true;
    const { writeWaiting } = await import('../loom-talk.js');
    await writeWaiting().catch(() => 0);
    now.disabled = false;
    draw();
  });
  const box = h('section', { class: 'card', id: 'settings-speech' }, h('h2', { text: t('settings.loom.speech') }),
    h('p', { class: 'muted', text: t('settings.loom.speech.hint') }),
    row(t('settings.loom.speech.lang'), t('settings.loom.speech.lang.hint'), langSeg),
    row(t('settings.loom.speech.engine'), t('settings.loom.speech.engine.hint'), engineSeg),
    row(t('settings.loom.speech.active'), '', active),
    check('loom-live', 'loom.live', t('settings.loom.speech.live'), t('settings.loom.speech.live.hint'), true),
    check('loom-autosend', 'loom.autoSend', t('settings.loom.speech.auto'), t('settings.loom.speech.auto.hint'), true),
    row(t('settings.loom.speech.mac'), `${MODEL_NAMES.mac}. ${t('settings.loom.speech.mac.hint')}`, mac),
    row(t('settings.loom.speech.here'), `${MODEL_NAMES.here}. ${t('settings.loom.speech.here.hint')}`, h('div', { class: 'loom-row-actions' }, here, load, forget)),
    row(t('settings.loom.speech.waiting'), t('settings.loom.speech.waiting.hint'), h('div', { class: 'loom-row-actions' }, wait, now)));
  const off = onWaitingChange(() => { if (box.isConnected) draw(); else off(); });
  draw();
  return box;
}
