import { extension_settings, renderExtensionTemplateAsync } from '../../../extensions.js';
import { chat, eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';

const EXTENSION_KEY = 'immersiveMode';
const VERSION = '0.2.0';

const DEFAULT_SETTINGS = {
  version: VERSION,
  autoOpen: false,
  splitBigBlocks: true,
  showProgress: true,
  showMessageIds: false,
  showButton: true,
  scrollMode: 'threshold',
  extractionMode: 'sentence',
  displayMode: 'rotary',
  position: 'center',
  weight: 'heavy',
  material: 'pearl',
  threshold: 0.32,
  fontSize: 38,
  spread: 220,
  fadeOnEnd: true,
  showInModeControls: true,
  hideStChrome: false,
  contextPreview: true,
  preventCodeHtmlCapture: true,
  excludeBracketPipes: true,
  mobileSwipeNavigation: true,
  showSendButton: true,
  streamCapture: true,
  emphasisAtomicMax: 140,
};

const extensionName = (() => {
  const match = import.meta.url.match(/extensions\/(third-party\/[^/]+)\//);
  return match ? match[1] : 'third-party/SillyTavern-ImmersiveMode';
})();

const WEIGHTS = {
  heavy: { wheel: 0.0032, threshold: 0.32, dur: 520 },
  silk: { wheel: 0.0042, threshold: 0.38, dur: 440 },
  fast: { wheel: 0.0058, threshold: 0.34, dur: 320 },
};

let initialized = false;
let host;
let root;
let stage;
let layers = [];
let fill;
let meta;
let fontRange;
let chromeButton;
let activeMessageId = null;
let beats = [];
let index = 0;
let visual = 0;
let dragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragStartOffset = 0;
let offset = 0;
let transitionRaf = null;
let targetIndex = 0;
let dragStartTargetIndex = 0;
let streamingMessageId = null;
let lastStreamingUpdate = 0;

function getSettings() {
  extension_settings[EXTENSION_KEY] = extension_settings[EXTENSION_KEY] || {};
  const settings = extension_settings[EXTENSION_KEY];
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (settings[key] === undefined) settings[key] = structuredClone(value);
  }
  settings.version = VERSION;
  if ((settings.displayDefaultsVersion || 0) < 3) {
    settings.displayMode = 'rotary';
    settings.contextPreview = true;
    if ((Number(settings.threshold) || 0) > 0.38) settings.threshold = 0.32;
    settings.displayDefaultsVersion = 3;
  }
  return settings;
}

function saveSettings() { saveSettingsDebounced(); }
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function stripTags(html) { const div = document.createElement('div'); div.innerHTML = String(html || ''); return div.textContent || ''; }
function escapeHtml(value) { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }

function normalizeMessageText(html) {
  const settings = getSettings();
  const div = document.createElement('div');
  div.innerHTML = String(html || '');
  div.querySelectorAll('script, style, .directional-roadway-panel, .mes_reasoning, .mes_reasoning_details').forEach(x => x.remove());
  if (settings.preventCodeHtmlCapture) div.querySelectorAll('pre, code, kbd, samp').forEach(x => x.remove());
  div.querySelectorAll('br').forEach(x => x.replaceWith('\n'));
  div.querySelectorAll('strong, b').forEach(el => el.replaceWith(document.createTextNode(`==${el.textContent || ''}==`)));
  div.querySelectorAll('em, i').forEach(el => el.replaceWith(document.createTextNode(`*${el.textContent || ''}*`)));
  let text = (div.textContent || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (settings.preventCodeHtmlCapture) {
    text = text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`]*`/g, ' ')
      .replace(/<(script|style|pre|code|kbd|samp)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/&lt;(script|style|pre|code|kbd|samp)\b[\s\S]*?&lt;\/\1&gt;/gi, ' ')
      .replace(/<\/?[a-z][^>]*>/gi, ' ')
      .replace(/&lt;\/?[a-z][\s\S]*?&gt;/gi, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  if (settings.excludeBracketPipes) text = text.replace(/\[[^\]\n]*\|[^\]\n]*\]/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return text;
}

function renderBeatHtml(text) {
  let safe = escapeHtml(text);
  safe = safe.replace(/==([^=]+)==/g, '<span class="im-pop">$1</span>');
  safe = safe.replace(/^\*([^]+)\*$/g, '<em>$1</em>');
  return safe;
}

function splitLongPlain(text) {
  const source = String(text || '').trim();
  if (!source) return [];
  const settings = getSettings();
  const mode = settings.extractionMode || 'sentence';
  const sentenceMode = mode === 'sentence';
  const punctuationMode = mode === 'punctuation';
  const maxShort = mode === 'balanced' ? 130 : 0;
  const maxSentence = mode === 'balanced' ? 155 : 72;
  if (!sentenceMode && !punctuationMode && source.length <= maxShort) return [source];
  const paraParts = source.split(/\n{2,}/).map(x => x.trim()).filter(Boolean);
  const out = [];
  for (const para of paraParts) {
    let sentences;
    if (window.Intl && Intl.Segmenter) sentences = [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(para)].map(s => s.segment.trim()).filter(Boolean);
    else sentences = para.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
    for (const sentence of (sentences.length ? sentences : [para])) {
      if (sentenceMode) out.push(sentence);
      else if (sentence.length <= maxSentence) out.push(sentence);
      else {
        const clausePattern = punctuationMode ? /(?<=,|—|;|:)\s+/ : /(?<=—|;|:)\s+/;
        const clauses = sentence.split(clausePattern).map(x => x.trim()).filter(Boolean);
        out.push(...(clauses.length > 1 ? clauses : [sentence]));
      }
    }
  }
  return out;
}

function tokenizeIntoBeats(text) {
  const out = [];
  const src = String(text || '');
  const atomRe = /("[^"\n]*(?:\n[^"\n]*)?"|“[^”]*”|\*[^*]+\*)/g;
  let last = 0;
  let match;
  while ((match = atomRe.exec(src))) {
    const before = src.slice(last, match.index).trim();
    if (before) out.push(...splitLongPlain(before));
    const atom = match[0].trim();
    if (atom.startsWith('*') && atom.endsWith('*')) {
      const inner = atom.slice(1, -1).trim();
      if (inner.length <= (Number(getSettings().emphasisAtomicMax) || DEFAULT_SETTINGS.emphasisAtomicMax)) out.push(atom);
      else out.push(...splitLongPlain(inner).map(piece => `*${piece}*`));
    } else out.push(atom);
    last = match.index + match[0].length;
  }
  const after = src.slice(last).trim();
  if (after) out.push(...splitLongPlain(after));
  return out.filter(Boolean);
}

function getMessageName(message) { if (message?.name) return message.name; return message?.is_user ? 'You' : 'Assistant'; }

function buildBeatsFromMessage(message, messageId) {
  const settings = getSettings();
  const text = normalizeMessageText(message?.mes || '');
  const raw = settings.splitBigBlocks ? tokenizeIntoBeats(text) : [text];
  return raw.filter(x => String(x).trim()).map((textBeat, i) => ({ html: renderBeatHtml(textBeat), who: i === 0 ? getMessageName(message) : '', id: i === 0 ? `#${messageId}` : '' }));
}

function shadowCss() {
  return `
    :host{all:initial;position:fixed;inset:48px 0 105px 0;z-index:99999;pointer-events:none;color:#f6f3eb;font-family:"Iowan Old Style","Palatino",Georgia,serif;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;}
    :host(.open){display:block}:host(:not(.open)){display:none}:host(.hide-chrome){inset:0}
    .stage{position:absolute;inset:0;overflow:hidden;perspective:1000px;pointer-events:auto;touch-action:none;user-select:none;cursor:grab}.stage.drag{cursor:grabbing}
    .layer{position:absolute;top:50%;left:50%;width:min(750px,88vw);text-align:center;font-size:var(--im-font-size,38px);line-height:1.55;letter-spacing:.12px;transform-style:preserve-3d;will-change:transform,opacity;backface-visibility:hidden;text-wrap:balance;}
    :host(.position-top) .layer{top:30%}:host(.position-center) .layer{top:50%}:host(.position-bottom) .layer{top:70%}
    .who{display:block;font-family:system-ui,sans-serif;font-size:11px;letter-spacing:2.6px;text-transform:uppercase;color:#7e8796;margin-bottom:12px;font-weight:500}.txt{display:inline;text-wrap:balance}.pop{font-weight:650;color:#fff;-webkit-text-fill-color:#fff;background:linear-gradient(120deg,transparent,rgba(255,207,107,.52));background-size:100% 82%;background-repeat:no-repeat;background-position:0 64%;padding:0 .1em;border-radius:4px;text-shadow:0 0 18px rgba(255,207,107,.45)}
    :host(.material-pearl) .txt{background:linear-gradient(180deg,#fff 0%,#e7edf7 55%,#aeb9ca 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;text-shadow:0 0 1px rgba(255,255,255,.7),0 0 10px rgba(230,240,255,.18),0 0 26px rgba(150,180,220,.12)}
    :host(.material-crystal) .txt{background:linear-gradient(176deg,#fff 0%,#f5f9ff 42%,#cfd9eb 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;filter:drop-shadow(0 0 2px rgba(255,255,255,.55)) drop-shadow(0 0 16px rgba(170,205,255,.38))}
    :host(.material-etched) .txt{color:rgba(246,243,235,.92);text-shadow:0 1px 0 rgba(255,255,255,.2),0 -1px 0 rgba(0,0,0,.6),0 0 14px rgba(210,225,255,.14)}
    :host(.material-liquid) .txt{background:linear-gradient(90deg,#eaf6ff 0%,#fff 42%,#d8e8ff 70%,#fff2c6 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;filter:drop-shadow(0 0 3px rgba(255,255,255,.65)) drop-shadow(0 0 22px rgba(130,190,255,.42))}
    .close,.pill{border:1px solid rgba(255,255,255,.08);background:rgba(10,12,18,.45);color:#9aa3b2;border-radius:999px;padding:7px 12px;font-family:system-ui,sans-serif;font-size:12px;cursor:pointer;backdrop-filter:blur(12px);pointer-events:auto}.close{position:absolute;top:14px;right:16px;z-index:3}.close:hover,.pill:hover,.pill.active{color:#fff;border-color:rgba(255,255,255,.18)}
    .controls{position:absolute;left:50%;bottom:52px;transform:translateX(-50%);z-index:3;display:flex;align-items:center;gap:8px;font-family:system-ui,sans-serif;opacity:.72;transition:opacity 180ms ease;pointer-events:auto}.controls:hover{opacity:1}:host(:not(.show-controls)) .controls{display:none}.range{width:120px;accent-color:#ffcf6b;pointer-events:auto}
    .hud{position:absolute;left:0;right:0;bottom:20px;z-index:2;display:flex;flex-direction:column;align-items:center;gap:8px;font-family:system-ui,sans-serif;pointer-events:none}:host(:not(.show-progress)) .hud{display:none}.rail{width:min(320px,46vw);height:2px;background:rgba(255,255,255,.06);border-radius:9px;overflow:hidden}.fill{height:100%;width:0;background:linear-gradient(90deg,rgba(180,205,255,.7),#ffcf6b)}.meta{font-size:10.5px;color:#5d6573;letter-spacing:1px}
    @media (max-width:900px),(pointer:coarse){:host,:host(.hide-chrome){inset:0;min-height:100dvh}.stage{min-height:100dvh}.layer{width:min(86vw,560px);font-size:clamp(21px,5.7vw,34px);line-height:1.62;letter-spacing:.02px}:host(.position-top) .layer{top:24%}:host(.position-center) .layer{top:47%}:host(.position-bottom) .layer{top:65%}.close{top:calc(env(safe-area-inset-top,0px) + 10px);right:10px;padding:8px 12px}.controls{bottom:calc(env(safe-area-inset-bottom,0px) + 72px);width:min(88vw,380px);justify-content:center;gap:8px;opacity:.78}.pill{padding:8px 12px;font-size:12px;min-width:42px}.range{width:min(34vw,140px)}.hud{bottom:calc(env(safe-area-inset-bottom,0px) + 30px)}.rail{width:min(58vw,260px)}}
    @media (max-width:420px){.layer{width:84vw;font-size:clamp(20px,5.45vw,30px);line-height:1.6}.controls{transform:translateX(-50%) scale(.9);bottom:calc(env(safe-area-inset-bottom,0px) + 76px)}}
  `;
}

function createOverlay() {
  if (host) return;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${shadowCss()}</style><button class="close">exit</button><div class="stage"><div class="layer" data-role="-1"></div><div class="layer" data-role="0"></div><div class="layer" data-role="1"></div></div><div class="controls"><button class="pill font-down">A−</button><input class="range font-range" type="range" min="18" max="64" step="1"><button class="pill font-up">A+</button><button class="pill toggle-chrome">bars</button></div><div class="hud"><div class="rail"><div class="fill"></div></div><div class="meta">— / —</div></div>`;
  stage = root.querySelector('.stage');
  layers = [...root.querySelectorAll('.layer')];
  fill = root.querySelector('.fill');
  meta = root.querySelector('.meta');
  root.querySelector('.close').addEventListener('click', closeImmersive);
  root.querySelector('.font-range').addEventListener('input', event => { const settings = getSettings(); settings.fontSize = Number(event.target.value) || DEFAULT_SETTINGS.fontSize; saveSettings(); applyOverlaySettings(); paint(); });
  root.querySelector('.font-down').addEventListener('click', () => adjustFontSize(-2));
  root.querySelector('.font-up').addEventListener('click', () => adjustFontSize(2));
  root.querySelector('.toggle-chrome').addEventListener('click', () => { const settings = getSettings(); settings.hideStChrome = !settings.hideStChrome; saveSettings(); applyOverlaySettings(); });
  attachMotionHandlers();
}

function resetMotion() { index = 0; targetIndex = 0; visual = 0; offset = 0; dragging = false; }
function adjustFontSize(delta) { const settings = getSettings(); settings.fontSize = clamp((Number(settings.fontSize) || DEFAULT_SETTINGS.fontSize) + delta, 18, 64); saveSettings(); applyOverlaySettings(); paint(); }

function applyOverlaySettings() {
  if (!host) return;
  const settings = getSettings();
  host.classList.toggle('show-progress', !!settings.showProgress);
  host.classList.toggle('show-controls', !!settings.showInModeControls);
  host.classList.toggle('hide-chrome', !!settings.hideStChrome);
  host.classList.remove('material-pearl', 'material-crystal', 'material-etched', 'material-liquid');
  host.classList.add(`material-${settings.material || 'pearl'}`);
  host.classList.remove('position-top', 'position-center', 'position-bottom');
  host.classList.add(`position-${settings.position || 'center'}`);
  host.style.setProperty('--im-font-size', `${Number(settings.fontSize) || DEFAULT_SETTINGS.fontSize}px`);
  root?.querySelector('.font-range') && (root.querySelector('.font-range').value = Number(settings.fontSize) || DEFAULT_SETTINGS.fontSize);
  root?.querySelector('.toggle-chrome')?.classList.toggle('active', !!settings.hideStChrome);
  document.body.classList.toggle('im-hide-st-chrome', !!settings.hideStChrome && host.classList.contains('open'));
}

function renderLayer(layer, beatIndex, d) {
  if (beatIndex < 0 || beatIndex >= beats.length) { layer.style.visibility = 'hidden'; layer.style.opacity = '0'; layer.innerHTML = ''; return; }
  const beat = beats[beatIndex];
  const settings = getSettings();
  const who = beat.who ? `<span class="who">${escapeHtml(beat.who)}</span>` : '';
  const id = settings.showMessageIds && beat.id ? `<span class="who">${escapeHtml(beat.id)}</span>` : '';
  layer.innerHTML = `${who}<span class="txt">${beat.html}</span>${id}`;
  const displayMode = settings.displayMode || 'rotary';
  const contextPreview = !!settings.contextPreview || displayMode === 'teleprompter' || displayMode === 'rotary';
  const dn = Math.abs(d);
  let opacity;
  if (contextPreview) {
    const activeCurve = Math.exp(-Math.pow(dn / 0.48, 2));
    const baseGhost = displayMode === 'spotlight' ? 0.12 : displayMode === 'rotary' ? 0.24 : 0.30;
    const ghostTail = baseGhost * Math.exp(-dn / 1.35);
    opacity = Math.min(1, activeCurve + ghostTail);
  } else opacity = Math.exp(-Math.pow(dn / 0.40, 2));
  const baseGap = Math.max(Number(settings.spread) || DEFAULT_SETTINGS.spread, (Number(settings.fontSize) || DEFAULT_SETTINGS.fontSize) * 4.1);
  const y = d * baseGap;
  const scale = displayMode === 'teleprompter' ? 0.82 + 0.18 * Math.min(1, opacity * 3) : 0.9 + 0.1 * Math.min(1, opacity * 4);
  const rot = displayMode === 'rotary' ? ` rotateX(${clamp(d, -2, 2) * -34}deg)` : '';
  layer.style.transform = `translate3d(-50%, calc(-50% + ${y.toFixed(2)}px), 0)${rot} scale(${scale.toFixed(3)})`;
  layer.style.opacity = opacity.toFixed(3);
  layer.style.filter = contextPreview && dn > 0.25 ? `blur(${Math.min(2.2, dn * 1.15).toFixed(2)}px)` : 'none';
  layer.style.visibility = opacity < 0.002 ? 'hidden' : 'visible';
}

function paint() {
  if (!host?.classList.contains('open') || !beats.length) return;
  const center = Math.round(visual);
  const roles = [-1, 0, 1];
  roles.forEach((role, i) => renderLayer(layers[i], center + role, (center + role) - visual));
  const progress = beats.length > 0 ? visual / beats.length : 0;
  fill.style.width = `${clamp(progress, 0, 1) * 100}%`;
  meta.textContent = index >= beats.length ? 'END' : `${Math.round(visual) + 1} / ${beats.length}`;
}

function openMessage(messageId) {
  const message = chat[messageId];
  if (!message || message.is_system) return;
  activeMessageId = Number(messageId);
  createOverlay();
  beats = buildBeatsFromMessage(message, activeMessageId);
  if (!beats.length) return;
  resetMotion();
  host.classList.remove('closing'); host.style.opacity = ''; host.style.transition = '';
  host.classList.add('open');
  document.body.classList.add('immersive-mode-active');
  applyOverlaySettings();
  paint();
}

function openLatestAssistant() { for (let i = chat.length - 1; i >= 0; i--) { if (chat[i] && !chat[i].is_user && !chat[i].is_system) { openMessage(i); return; } } toastr?.warning?.('No assistant message found.', 'Immersive Mode'); }

function updateStreamingMessage() {
  const settings = getSettings();
  if (!settings.streamCapture) return;
  const now = performance.now();
  if (now - lastStreamingUpdate < 120) return;
  lastStreamingUpdate = now;
  const messageId = chat.length - 1;
  const message = chat[messageId];
  if (!message || message.is_user || message.is_system) return;
  const nextBeats = buildBeatsFromMessage(message, messageId);
  if (!nextBeats.length) return;
  createOverlay();
  activeMessageId = Number(messageId);
  beats = nextBeats;
  index = clamp(index, 0, Math.max(0, beats.length - 1));
  targetIndex = clamp(targetIndex, 0, Math.max(0, beats.length - 1));
  visual = clamp(visual, 0, Math.max(0, beats.length - 1));
  host.classList.remove('closing'); host.style.opacity = ''; host.style.transition = '';
  host.classList.add('open');
  document.body.classList.add('immersive-mode-active');
  applyOverlaySettings();
  paint();
}

function finishCloseImmersive() { host?.classList.remove('open', 'closing'); if (host) { host.style.opacity = ''; host.style.transition = ''; } document.body.classList.remove('immersive-mode-active', 'im-hide-st-chrome'); }
function fadeCloseImmersive() { if (!host?.classList.contains('open') || host.classList.contains('closing')) return; host.classList.add('closing'); host.style.transition = 'opacity 420ms ease'; host.style.opacity = '0'; setTimeout(finishCloseImmersive, 430); }
function closeImmersive() { fadeCloseImmersive(); }

function startSettle(toIndex) {
  toIndex = clamp(toIndex, 0, beats.length);
  targetIndex = toIndex;
  if (toIndex >= beats.length && index >= beats.length && getSettings().fadeOnEnd) { fadeCloseImmersive(); return; }
  if (transitionRaf) cancelAnimationFrame(transitionRaf);
  const from = visual;
  const to = toIndex;
  const start = performance.now();
  const dur = getWeight().dur;
  function step(now) {
    const t = clamp((now - start) / dur, 0, 1);
    visual = from + (to - from) * easeOutCubic(t);
    paint();
    if (t < 1) transitionRaf = requestAnimationFrame(step);
    else { index = to; targetIndex = to; visual = to; offset = 0; transitionRaf = null; paint(); }
  }
  transitionRaf = requestAnimationFrame(step);
}

function thresholdResolve() {
  const threshold = Number(getSettings().threshold) || getWeight().threshold;
  const base = Math.round(clamp(visual, 0, beats.length));
  if (offset >= threshold) startSettle(base + 1);
  else if (offset <= -threshold) startSettle(base - 1);
}
function getWeight() { return WEIGHTS[getSettings().weight] || WEIGHTS.heavy; }

function inputStarted() {
  if (transitionRaf) {
    cancelAnimationFrame(transitionRaf);
    transitionRaf = null;
  }
  // Preserve the actual on-screen position when user interrupts an animation.
  index = Math.floor(clamp(visual, 0, Math.max(0, beats.length - 1)));
  targetIndex = Math.round(clamp(visual, 0, beats.length));
  offset = visual - index;
}

function attachMotionHandlers() {
  stage.addEventListener('wheel', event => {
    event.preventDefault();
    const settings = getSettings();
    const direction = event.deltaY > 0 ? 1 : -1;
    if (settings.scrollMode === 'step') { startSettle(targetIndex + direction); return; }
    // If the user wheels again during a transition, chain from the pending target immediately.
    if (transitionRaf && Math.abs(event.deltaY) > 18) { startSettle(targetIndex + direction); return; }
    inputStarted();
    offset = clamp(offset + event.deltaY * getWeight().wheel, -0.95, 0.95);
    visual = index + offset;
    paint();
    clearTimeout(stage._imWheelTimer);
    if (Math.abs(offset) >= (Number(settings.threshold) || getWeight().threshold)) {
      const dir = offset > 0 ? 1 : -1;
      offset = 0;
      startSettle(targetIndex + dir);
    } else {
      stage._imWheelTimer = setTimeout(thresholdResolve, 120);
    }
  }, { passive: false });
  stage.addEventListener('pointerdown', event => { dragging = true; inputStarted(); dragStartX = event.clientX; dragStartY = event.clientY; dragStartOffset = offset; stage.classList.add('drag'); stage.setPointerCapture(event.pointerId); });
  stage.addEventListener('pointermove', event => { if (!dragging) return; const stepSize = Math.max(Number(getSettings().spread) || DEFAULT_SETTINGS.spread, (Number(getSettings().fontSize) || DEFAULT_SETTINGS.fontSize) * 4.1); offset = clamp(dragStartOffset - (event.clientY - dragStartY) / stepSize, -0.95, 0.95); visual = index + offset; paint(); });
  stage.addEventListener('pointerup', event => { dragging = false; stage.classList.remove('drag'); const dx = event.clientX - dragStartX; const dy = event.clientY - dragStartY; if (getSettings().mobileSwipeNavigation && Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.25) { offset = 0; startSettle(targetIndex + (dx < 0 ? 1 : -1)); return; } thresholdResolve(); });
  document.addEventListener('keydown', event => { if (!host?.classList.contains('open')) return; if (['ArrowDown', 'ArrowRight', 'Space'].includes(event.code)) { event.preventDefault(); event.stopPropagation(); startSettle(targetIndex + 1); } if (['ArrowUp', 'ArrowLeft'].includes(event.code)) { event.preventDefault(); event.stopPropagation(); startSettle(targetIndex - 1); } if (event.code === 'Escape') { event.preventDefault(); event.stopPropagation(); closeImmersive(); } }, true);
}

function addMessageButton() { if ($('#message_template .mes_immersive_mode_button').length) return; const button = $('<div title="Open immersive reader" class="mes_button mes_immersive_mode_button fa-solid fa-book-open interactable" tabindex="0"></div>'); $('#message_template .mes_buttons .extraMesButtons').prepend(button); updateMessageButtonVisibility(); }
function addSendButton() { if ($('#rightSendForm .im_send_immersive_button').length) return; const button = $('<div title="Open immersive reader" class="fa-solid fa-book-open interactable im_send_immersive_button" tabindex="0"></div>'); $('#rightSendForm').prepend(button); updateSendButtonVisibility(); }
function updateSendButtonVisibility() { document.body.classList.toggle('im-send-button-hidden', !getSettings().showSendButton); }
function updateMessageButtonVisibility() { $('.mes_immersive_mode_button').toggle(!!getSettings().showButton); }
function attachDelegatedHandlers() { $(document).off('click.immersiveModeButton').on('click.immersiveModeButton', '.mes_immersive_mode_button', function () { openMessage(Number($(this).closest('.mes').attr('mesid'))); }); $(document).off('click.immersiveModeSendButton').on('click.immersiveModeSendButton', '.im_send_immersive_button', openLatestAssistant); }

async function addSettingsUi() {
  const html = await renderExtensionTemplateAsync(extensionName, 'settings');
  $('#extensions_settings').append(html);
  const settings = getSettings();
  const container = $('.immersive_mode_settings');
  container.find('.im_auto_open').prop('checked', settings.autoOpen).on('change', function () { settings.autoOpen = !!$(this).prop('checked'); saveSettings(); });
  container.find('.im_split_big_blocks').prop('checked', settings.splitBigBlocks).on('change', function () { settings.splitBigBlocks = !!$(this).prop('checked'); saveSettings(); });
  container.find('.im_show_progress').prop('checked', settings.showProgress).on('change', function () { settings.showProgress = !!$(this).prop('checked'); saveSettings(); applyOverlaySettings(); });
  container.find('.im_show_message_ids').prop('checked', settings.showMessageIds).on('change', function () { settings.showMessageIds = !!$(this).prop('checked'); saveSettings(); paint(); });
  container.find('.im_show_button').prop('checked', settings.showButton).on('change', function () { settings.showButton = !!$(this).prop('checked'); saveSettings(); updateMessageButtonVisibility(); });
  container.find('.im_fade_on_end').prop('checked', settings.fadeOnEnd).on('change', function () { settings.fadeOnEnd = !!$(this).prop('checked'); saveSettings(); });
  container.find('.im_show_inmode_controls').prop('checked', settings.showInModeControls).on('change', function () { settings.showInModeControls = !!$(this).prop('checked'); saveSettings(); applyOverlaySettings(); });
  container.find('.im_hide_st_chrome').prop('checked', settings.hideStChrome).on('change', function () { settings.hideStChrome = !!$(this).prop('checked'); saveSettings(); applyOverlaySettings(); });
  container.find('.im_context_preview').prop('checked', settings.contextPreview).on('change', function () { settings.contextPreview = !!$(this).prop('checked'); saveSettings(); paint(); });
  container.find('.im_prevent_code_html').prop('checked', settings.preventCodeHtmlCapture).on('change', function () { settings.preventCodeHtmlCapture = !!$(this).prop('checked'); saveSettings(); });
  container.find('.im_exclude_bracket_pipes').prop('checked', settings.excludeBracketPipes).on('change', function () { settings.excludeBracketPipes = !!$(this).prop('checked'); saveSettings(); });
  container.find('.im_mobile_swipe').prop('checked', settings.mobileSwipeNavigation).on('change', function () { settings.mobileSwipeNavigation = !!$(this).prop('checked'); saveSettings(); });
  container.find('.im_stream_capture').prop('checked', settings.streamCapture).on('change', function () { settings.streamCapture = !!$(this).prop('checked'); saveSettings(); });
  container.find('.im_show_send_button').prop('checked', settings.showSendButton).on('change', function () { settings.showSendButton = !!$(this).prop('checked'); saveSettings(); updateSendButtonVisibility(); });
  container.find('.im_extraction_mode').val(settings.extractionMode).on('change', function () { settings.extractionMode = String($(this).val() || 'sentence'); saveSettings(); });
  container.find('.im_display_mode').val(settings.displayMode).on('change', function () { settings.displayMode = String($(this).val() || 'rotary'); saveSettings(); paint(); });
  container.find('.im_position').val(settings.position).on('change', function () { settings.position = String($(this).val() || 'center'); saveSettings(); });
  container.find('.im_scroll_mode').val(settings.scrollMode).on('change', function () { settings.scrollMode = String($(this).val() || 'threshold'); saveSettings(); });
  container.find('.im_weight').val(settings.weight).on('change', function () { settings.weight = String($(this).val() || 'heavy'); saveSettings(); });
  container.find('.im_material').val(settings.material).on('change', function () { settings.material = String($(this).val() || 'pearl'); saveSettings(); applyOverlaySettings(); });
  container.find('.im_threshold').val(settings.threshold).on('input change', function () { settings.threshold = Number($(this).val()) || DEFAULT_SETTINGS.threshold; saveSettings(); });
  container.find('.im_font_size').val(settings.fontSize).on('input change', function () { settings.fontSize = Number($(this).val()) || DEFAULT_SETTINGS.fontSize; saveSettings(); applyOverlaySettings(); paint(); });
  container.find('.im_spread').val(settings.spread).on('input change', function () { settings.spread = Number($(this).val()) || DEFAULT_SETTINGS.spread; saveSettings(); paint(); });
  container.find('.im_open_now').on('click', openLatestAssistant);
  container.find('.im_close_now').on('click', closeImmersive);
}

function registerEvents() { eventSource.makeLast(event_types.CHARACTER_MESSAGE_RENDERED, (messageId, type) => { const message = chat[messageId]; if (!message || message.is_user || message.is_system) return; if (getSettings().autoOpen && ['normal', 'continue', 'swipe'].includes(type || 'normal')) openMessage(Number(messageId)); }); eventSource.on(event_types.STREAM_TOKEN_RECEIVED, updateStreamingMessage); eventSource.on(event_types.CHAT_CHANGED, closeImmersive); }
function registerSlashCommand() { SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'immersive', callback: () => { openLatestAssistant(); return ''; }, helpString: 'Open Immersive Mode for the latest assistant message.' })); }
function exposePublicApi() { globalThis.SillyTavernImmersiveMode = { openLatest: openLatestAssistant, openMessage, close: closeImmersive, debugOpenHtml(html, name = 'Seraphine') { createOverlay(); activeMessageId = -1; beats = buildBeatsFromMessage({ mes: String(html || ''), name, is_user: false, is_system: false }, 'debug'); resetMotion(); host.classList.remove('closing'); host.style.opacity = ''; host.style.transition = ''; host.classList.add('open'); document.body.classList.add('immersive-mode-active'); applyOverlaySettings(); paint(); }, getState() { return { activeMessageId, beats: beats.map(b => stripTags(b.html)), index, targetIndex, visual, open: host?.classList.contains('open') || false, renderedLayers: layers.length }; }, debugSegmentHtml(html) { return buildBeatsFromMessage({ mes: String(html || ''), name: 'debug', is_user: false, is_system: false }, 'debug').map(b => stripTags(b.html)); }, debugSetSettings(next) { Object.assign(getSettings(), next || {}); saveSettings(); if (host) applyOverlaySettings(); } }; }

async function init() { if (initialized) return; initialized = true; getSettings(); await addSettingsUi(); createOverlay(); addMessageButton(); addSendButton(); attachDelegatedHandlers(); registerEvents(); registerSlashCommand(); exposePublicApi(); console.log('[Immersive Mode] Loaded layered reader engine.'); }
init().catch(error => { console.error('[Immersive Mode] Init failed:', error); toastr?.error?.(`Init failed: ${error?.message || error}`, 'Immersive Mode'); });
