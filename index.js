import { extension_settings, renderExtensionTemplateAsync } from '../../../extensions.js';
import { chat, eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';

const EXTENSION_KEY = 'immersiveMode';
const VERSION = '0.1.0';

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
  threshold: 0.46,
  fontSize: 38,
  spread: 220,
  fadeOnEnd: true,
  showInModeControls: true,
  hideStChrome: false,
  contextPreview: true,
  preventCodeHtmlCapture: true,
  emphasisAtomicMax: 140,
};

const extensionName = (() => {
  const match = import.meta.url.match(/extensions\/(third-party\/[^/]+)\//);
  return match ? match[1] : 'third-party/SillyTavern-ImmersiveMode';
})();

const WEIGHTS = {
  heavy: { wheel: 0.00042, friction: 0.86, threshold: 0.46, dur: 680 },
  silk: { wheel: 0.00062, friction: 0.82, threshold: 0.42, dur: 560 },
  fast: { wheel: 0.0009, friction: 0.75, threshold: 0.38, dur: 420 },
};

let initialized = false;
let overlay;
let stage;
let world;
let fill;
let meta;
let closeButton;
let activeMessageId = null;
let beats = [];
let elements = [];
let halfHeights = [];
let beatCenters = [];
let index = 0;
let offset = 0;
let velocity = 0;
let settling = false;
let settleFrom = 0;
let settleTo = 0;
let settleStart = 0;
let settleDur = 520;
let dragging = false;
let dragStartY = 0;
let dragStartOffset = 0;
let lastTs = performance.now();
let rafStarted = false;

function getSettings() {
  extension_settings[EXTENSION_KEY] = extension_settings[EXTENSION_KEY] || {};
  const settings = extension_settings[EXTENSION_KEY];
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (settings[key] === undefined) settings[key] = structuredClone(value);
  }
  settings.version = VERSION;
  if ((settings.displayDefaultsVersion || 0) < 2) {
    settings.displayMode = 'rotary';
    settings.contextPreview = true;
    settings.displayDefaultsVersion = 2;
  }
  return settings;
}

function saveSettings() { saveSettingsDebounced(); }
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function smoothstep(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function stripTags(html) { const div = document.createElement('div'); div.innerHTML = String(html || ''); return div.textContent || ''; }
function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function normalizeMessageText(html) {
  const settings = getSettings();
  const div = document.createElement('div');
  div.innerHTML = String(html || '');
  div.querySelectorAll('script, style, .directional-roadway-panel').forEach(x => x.remove());
  if (settings.preventCodeHtmlCapture) {
    div.querySelectorAll('pre, code, kbd, samp').forEach(x => x.remove());
  }
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
    if (window.Intl && Intl.Segmenter) {
      sentences = [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(para)].map(s => s.segment.trim()).filter(Boolean);
    } else {
      sentences = para.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
    }
    for (const sentence of (sentences.length ? sentences : [para])) {
      if (sentenceMode) {
        out.push(sentence);
      } else if (sentence.length <= maxSentence) {
        out.push(sentence);
      } else {
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
  // Atomic regions: quoted dialogue and asterisk-emphasis thoughts/actions.
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
    } else {
      out.push(atom);
    }
    last = match.index + match[0].length;
  }
  const after = src.slice(last).trim();
  if (after) out.push(...splitLongPlain(after));
  return out.filter(Boolean);
}

function getMessageName(message) {
  if (message?.name) return message.name;
  return message?.is_user ? 'You' : 'Assistant';
}

function buildBeatsFromMessage(message, messageId) {
  const settings = getSettings();
  const text = normalizeMessageText(message?.mes || '');
  const raw = settings.splitBigBlocks ? tokenizeIntoBeats(text) : [text];
  return raw.filter(x => String(x).trim()).map((textBeat, i) => ({
    html: renderBeatHtml(textBeat),
    who: i === 0 ? getMessageName(message) : '',
    id: i === 0 ? `#${messageId}` : '',
  }));
}

function createOverlay() {
  if (overlay) return;
  overlay = document.createElement('div');
  overlay.className = 'im-overlay';
  overlay.innerHTML = `
    <button class="im-close" title="Close immersive mode">exit</button>
    <div class="im-stage"><div class="im-world"></div></div>
    <div class="im-controls">
      <button class="im-control-pill im-font-down" title="Smaller text">A−</button>
      <input class="im-control-range im-font-range" type="range" min="18" max="64" step="1" />
      <button class="im-control-pill im-font-up" title="Larger text">A+</button>
      <button class="im-control-pill im-toggle-chrome" title="Toggle top/chat bars">bars</button>
    </div>
    <div class="im-hud"><div class="im-rail"><div class="im-fill"></div></div><div class="im-meta">— / —</div></div>
  `;
  document.body.appendChild(overlay);
  stage = overlay.querySelector('.im-stage');
  world = overlay.querySelector('.im-world');
  fill = overlay.querySelector('.im-fill');
  meta = overlay.querySelector('.im-meta');
  closeButton = overlay.querySelector('.im-close');
  closeButton.addEventListener('click', closeImmersive);
  overlay.querySelector('.im-font-range').addEventListener('input', event => {
    const settings = getSettings();
    settings.fontSize = Number(event.target.value) || DEFAULT_SETTINGS.fontSize;
    saveSettings();
    applyOverlaySettings();
  });
  overlay.querySelector('.im-font-down').addEventListener('click', () => adjustFontSize(-2));
  overlay.querySelector('.im-font-up').addEventListener('click', () => adjustFontSize(2));
  overlay.querySelector('.im-toggle-chrome').addEventListener('click', () => {
    const settings = getSettings();
    settings.hideStChrome = !settings.hideStChrome;
    saveSettings();
    applyOverlaySettings();
  });
  attachMotionHandlers();
}

function resetMotion() {
  index = 0; offset = 0; velocity = 0; settling = false; dragging = false;
}

function recalculateBeatMetrics() {
  halfHeights = elements.map(el => el.offsetHeight / 2);
  const settings = getSettings();
  const baseSpread = Number(settings.spread) || DEFAULT_SETTINGS.spread;
  const gap = clamp(baseSpread * 0.35, 44, 120);
  beatCenters = [];
  let cursor = 0;
  for (let i = 0; i < elements.length; i++) {
    if (i === 0) {
      beatCenters[i] = 0;
      continue;
    }
    cursor += halfHeights[i - 1] + halfHeights[i] + gap;
    beatCenters[i] = cursor;
  }
}

function getLocalStep(direction = 1) {
  if (direction >= 0 && index < beatCenters.length - 1) return Math.max(1, beatCenters[index + 1] - beatCenters[index]);
  if (direction < 0 && index > 0) return Math.max(1, beatCenters[index] - beatCenters[index - 1]);
  return Math.max(Number(getSettings().spread) || DEFAULT_SETTINGS.spread, (Number(getSettings().fontSize) || DEFAULT_SETTINGS.fontSize) * 4.3);
}

function centerForVisual(visual) {
  if (!beatCenters.length) return 0;
  const lo = Math.floor(clamp(visual, 0, beatCenters.length - 1));
  const hi = Math.ceil(clamp(visual, 0, beatCenters.length - 1));
  if (lo === hi) return beatCenters[lo] || 0;
  const t = visual - lo;
  return (beatCenters[lo] || 0) + ((beatCenters[hi] || 0) - (beatCenters[lo] || 0)) * t;
}

function adjustFontSize(delta) {
  const settings = getSettings();
  settings.fontSize = clamp((Number(settings.fontSize) || DEFAULT_SETTINGS.fontSize) + delta, 18, 64);
  saveSettings();
  applyOverlaySettings();
}

function applyOverlaySettings() {
  if (!overlay) return;
  const settings = getSettings();
  overlay.classList.toggle('im-show-progress', !!settings.showProgress);
  overlay.classList.toggle('im-show-controls', !!settings.showInModeControls);
  overlay.classList.toggle('im-hide-chrome', !!settings.hideStChrome);
  overlay.classList.remove('im-position-top', 'im-position-center', 'im-position-bottom');
  overlay.classList.add(`im-position-${settings.position || 'center'}`);
  overlay.classList.remove('im-material-pearl', 'im-material-crystal', 'im-material-etched', 'im-material-liquid');
  overlay.classList.add(`im-material-${settings.material || 'pearl'}`);
  overlay.style.setProperty('--im-font-size', `${Number(settings.fontSize) || DEFAULT_SETTINGS.fontSize}px`);
  overlay.querySelector('.im-font-range').value = Number(settings.fontSize) || DEFAULT_SETTINGS.fontSize;
  overlay.querySelector('.im-toggle-chrome').classList.toggle('im-active', !!settings.hideStChrome);
  document.body.classList.toggle('im-hide-st-chrome', !!settings.hideStChrome && overlay.classList.contains('im-open'));
  requestAnimationFrame(() => {
    recalculateBeatMetrics();
    paint();
  });
}

function renderBeats() {
  world.innerHTML = '';
  elements = [];
  halfHeights = [];
  const settings = getSettings();
  applyOverlaySettings();

  beats.forEach((beat, i) => {
    const el = document.createElement('div');
    el.className = 'im-beat';
    const who = beat.who ? `<span class="im-who">${escapeHtml(beat.who)}</span>` : '';
    const id = settings.showMessageIds && beat.id ? `<span class="im-who">${escapeHtml(beat.id)}</span>` : '';
    el.innerHTML = `${who}<span class="im-txt">${beat.html}</span>${id}`;
    world.appendChild(el);
    elements.push(el);
  });
  requestAnimationFrame(() => {
    recalculateBeatMetrics();
    paint();
  });
}

function openMessage(messageId) {
  const message = chat[messageId];
  if (!message || message.is_system) return;
  activeMessageId = Number(messageId);
  createOverlay();
  beats = buildBeatsFromMessage(message, activeMessageId);
  if (!beats.length) return;
  resetMotion();
  renderBeats();
  overlay.classList.remove('im-closing');
  overlay.style.opacity = '';
  overlay.style.transition = '';
  overlay.classList.add('im-open');
  document.body.classList.add('immersive-mode-active');
  applyOverlaySettings();
  if (!rafStarted) { rafStarted = true; requestAnimationFrame(loop); }
}

function openLatestAssistant() {
  for (let i = chat.length - 1; i >= 0; i--) {
    if (chat[i] && !chat[i].is_user && !chat[i].is_system) { openMessage(i); return; }
  }
  toastr?.warning?.('No assistant message found.', 'Immersive Mode');
}

function finishCloseImmersive() {
  overlay?.classList.remove('im-open', 'im-closing');
  if (overlay) { overlay.style.opacity = ''; overlay.style.transition = ''; }
  document.body.classList.remove('immersive-mode-active', 'im-hide-st-chrome');
}

function closeImmersive() {
  fadeCloseImmersive();
}

function fadeCloseImmersive() {
  if (!overlay?.classList.contains('im-open')) return;
  if (overlay.classList.contains('im-closing')) return;
  overlay.classList.add('im-closing');
  overlay.style.transition = 'opacity 420ms ease';
  overlay.style.opacity = '0';
  setTimeout(finishCloseImmersive, 430);
}

function startSettle(toIndex) {
  // beats.length is a valid sentinel: the empty END state after the last beat.
  toIndex = clamp(toIndex, 0, beats.length);
  const current = index + offset;
  settleFrom = current;
  settleTo = toIndex;
  settleStart = performance.now();
  settleDur = getWeight().dur;
  settling = true;
  velocity = 0;
}

function thresholdResolve() {
  const settings = getSettings();
  if (settings.scrollMode !== 'threshold') return;
  const threshold = Number(settings.threshold) || getWeight().threshold;
  // At empty END: another downward scroll exits back to chat.
  if (index >= beats.length && offset >= threshold && settings.fadeOnEnd) {
    fadeCloseImmersive();
    return;
  }
  if (offset >= threshold) startSettle(index + 1);
  else if (offset <= -threshold) startSettle(index - 1);
}

function getWeight() { return WEIGHTS[getSettings().weight] || WEIGHTS.heavy; }

function paint() {
  if (!overlay?.classList.contains('im-open') || !elements.length) return;
  const visual = index + offset;
  const mid = overlay.clientHeight / 2;
  const settings = getSettings();
  const displayMode = settings.displayMode || 'spotlight';
  const contextPreview = !!settings.contextPreview || displayMode === 'teleprompter' || displayMode === 'rotary';
  const currentCenter = centerForVisual(visual);
  elements.forEach((el, i) => {
    const d = i - visual;
    const y = mid + ((beatCenters[i] || 0) - currentCenter);
    const dn = Math.abs(d);
    const farLimit = contextPreview ? 3.0 : 1.35;
    if (dn > farLimit) {
      el.style.visibility = 'hidden';
      el.style.opacity = '0';
      el.style.filter = 'none';
      return;
    }

    let opacity;
    if (contextPreview) {
      // Continuous curves: no hard switch between active and ghost states.
      // This removes the blink/pop when previous/next text crosses the spotlight edge.
      const activeCurve = Math.exp(-Math.pow(dn / 0.48, 2));
      const baseGhost = displayMode === 'spotlight' ? 0.12 : displayMode === 'rotary' ? 0.24 : 0.30;
      const ghostTail = baseGhost * Math.exp(-dn / 1.35);
      opacity = Math.min(1, activeCurve + ghostTail);
    } else {
      opacity = Math.exp(-Math.pow(dn / 0.40, 2));
    }

    const scale = displayMode === 'teleprompter'
      ? 0.82 + 0.18 * Math.min(1, opacity * 3)
      : 0.9 + 0.1 * Math.min(1, opacity * 4);
    const half = halfHeights[i] || 0;
    const rot = displayMode === 'rotary' ? ` rotateX(${clamp(d, -2, 2) * -34}deg)` : '';
    el.style.transform = `translate3d(0, ${(y - mid - half).toFixed(2)}px, 0)${rot} scale(${scale.toFixed(3)})`;
    el.style.opacity = opacity.toFixed(3);
    const blur = contextPreview && dn > 0.25 ? Math.min(2.2, dn * 1.15) : 0;
    el.style.filter = blur > 0.03 ? `blur(${blur.toFixed(2)}px)` : 'none';
    el.style.visibility = opacity < 0.002 ? 'hidden' : 'visible';
  });
  const progress = beats.length > 0 ? visual / beats.length : 0;
  fill.style.width = `${clamp(progress, 0, 1) * 100}%`;
  meta.textContent = index >= beats.length ? 'END' : `${Math.round(visual) + 1} / ${beats.length}`;
}

function loop(ts) {
  const dt = Math.min(40, ts - lastTs);
  lastTs = ts;
  const frames = dt / 16.67;
  if (overlay?.classList.contains('im-open')) {
    if (settling) {
      const t = clamp((ts - settleStart) / settleDur, 0, 1);
      const cur = settleFrom + (settleTo - settleFrom) * easeOutCubic(t);
      index = Math.floor(clamp(settleTo, 0, beats.length));
      offset = cur - index;
      if (t >= 1) {
        index = settleTo; offset = 0; settling = false;
      }
    } else if (!dragging) {
      offset += velocity * frames;
      velocity *= Math.pow(getWeight().friction, frames);
      offset = clamp(offset, -0.95, 0.95);
      if (Math.abs(velocity) < 0.0008 && Math.abs(offset) > 0.001) thresholdResolve();
    }
    paint();
  }
  requestAnimationFrame(loop);
}

function inputStarted() { settling = false; }

function attachMotionHandlers() {
  stage.addEventListener('wheel', event => {
    event.preventDefault();
    inputStarted();
    const settings = getSettings();
    if (settings.scrollMode === 'step') {
      if (index >= beats.length && event.deltaY > 0 && settings.fadeOnEnd) fadeCloseImmersive();
      else startSettle(index + (event.deltaY > 0 ? 1 : -1));
      return;
    }
    const weight = getWeight();
    velocity += event.deltaY * weight.wheel;
    offset += event.deltaY * weight.wheel * 0.45;
    offset = clamp(offset, -0.95, 0.95);
    clearTimeout(stage._imWheelTimer);
    stage._imWheelTimer = setTimeout(thresholdResolve, 120);
  }, { passive: false });

  stage.addEventListener('pointerdown', event => {
    dragging = true;
    inputStarted();
    dragStartY = event.clientY;
    dragStartOffset = offset;
    stage.classList.add('im-drag');
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener('pointermove', event => {
    if (!dragging) return;
    const dragStep = getLocalStep(event.clientY < dragStartY ? 1 : -1);
    offset = clamp(dragStartOffset - (event.clientY - dragStartY) / dragStep, -0.95, 0.95);
    velocity = 0;
  });
  stage.addEventListener('pointerup', () => {
    dragging = false;
    stage.classList.remove('im-drag');
    thresholdResolve();
  });

  document.addEventListener('keydown', event => {
    if (!overlay?.classList.contains('im-open')) return;
    if (['ArrowDown', 'ArrowRight', 'Space'].includes(event.code)) {
      event.preventDefault(); event.stopPropagation();
      if (index >= beats.length && getSettings().fadeOnEnd) fadeCloseImmersive();
      else startSettle(index + 1);
    }
    if (['ArrowUp', 'ArrowLeft'].includes(event.code)) { event.preventDefault(); event.stopPropagation(); startSettle(index - 1); }
    if (event.code === 'Escape') { event.preventDefault(); event.stopPropagation(); closeImmersive(); }
  }, true);

  window.addEventListener('resize', () => {
    if (!overlay?.classList.contains('im-open')) return;
    requestAnimationFrame(() => {
      recalculateBeatMetrics();
      paint();
    });
  });
}

function addMessageButton() {
  if ($('#message_template .mes_immersive_mode_button').length) return;
  const button = $('<div title="Open immersive reader" class="mes_button mes_immersive_mode_button fa-solid fa-book-open interactable" tabindex="0"></div>');
  $('#message_template .mes_buttons .extraMesButtons').prepend(button);
  updateMessageButtonVisibility();
}

function updateMessageButtonVisibility() {
  const visible = !!getSettings().showButton;
  $('.mes_immersive_mode_button').toggle(visible);
}

function attachDelegatedHandlers() {
  $(document).off('click.immersiveModeButton').on('click.immersiveModeButton', '.mes_immersive_mode_button', function () {
    const messageId = Number($(this).closest('.mes').attr('mesid'));
    openMessage(messageId);
  });
}

async function addSettingsUi() {
  const html = await renderExtensionTemplateAsync(extensionName, 'settings');
  $('#extensions_settings').append(html);
  const settings = getSettings();
  const container = $('.immersive_mode_settings');

  container.find('.im_auto_open').prop('checked', settings.autoOpen).on('change', function () { settings.autoOpen = !!$(this).prop('checked'); saveSettings(); });
  container.find('.im_split_big_blocks').prop('checked', settings.splitBigBlocks).on('change', function () { settings.splitBigBlocks = !!$(this).prop('checked'); saveSettings(); });
  container.find('.im_show_progress').prop('checked', settings.showProgress).on('change', function () { settings.showProgress = !!$(this).prop('checked'); saveSettings(); if (overlay) renderBeats(); });
  container.find('.im_show_message_ids').prop('checked', settings.showMessageIds).on('change', function () { settings.showMessageIds = !!$(this).prop('checked'); saveSettings(); if (overlay) renderBeats(); });
  container.find('.im_show_button').prop('checked', settings.showButton).on('change', function () { settings.showButton = !!$(this).prop('checked'); saveSettings(); updateMessageButtonVisibility(); });
  container.find('.im_fade_on_end').prop('checked', settings.fadeOnEnd).on('change', function () { settings.fadeOnEnd = !!$(this).prop('checked'); saveSettings(); });
  container.find('.im_show_inmode_controls').prop('checked', settings.showInModeControls).on('change', function () { settings.showInModeControls = !!$(this).prop('checked'); saveSettings(); applyOverlaySettings(); });
  container.find('.im_hide_st_chrome').prop('checked', settings.hideStChrome).on('change', function () { settings.hideStChrome = !!$(this).prop('checked'); saveSettings(); applyOverlaySettings(); });
  container.find('.im_context_preview').prop('checked', settings.contextPreview).on('change', function () { settings.contextPreview = !!$(this).prop('checked'); saveSettings(); paint(); });
  container.find('.im_prevent_code_html').prop('checked', settings.preventCodeHtmlCapture).on('change', function () { settings.preventCodeHtmlCapture = !!$(this).prop('checked'); saveSettings(); if (overlay && activeMessageId !== null) renderBeats(); });
  container.find('.im_extraction_mode').val(settings.extractionMode).on('change', function () { settings.extractionMode = String($(this).val() || 'sentence'); saveSettings(); if (overlay && activeMessageId !== null) renderBeats(); });
  container.find('.im_display_mode').val(settings.displayMode).on('change', function () { settings.displayMode = String($(this).val() || 'spotlight'); saveSettings(); paint(); });
  container.find('.im_position').val(settings.position).on('change', function () { settings.position = String($(this).val() || 'center'); saveSettings(); applyOverlaySettings(); });
  container.find('.im_scroll_mode').val(settings.scrollMode).on('change', function () { settings.scrollMode = String($(this).val() || 'threshold'); saveSettings(); });
  container.find('.im_weight').val(settings.weight).on('change', function () { settings.weight = String($(this).val() || 'heavy'); saveSettings(); });
  container.find('.im_material').val(settings.material).on('change', function () { settings.material = String($(this).val() || 'pearl'); saveSettings(); if (overlay) renderBeats(); });
  container.find('.im_threshold').val(settings.threshold).on('input change', function () { settings.threshold = Number($(this).val()) || DEFAULT_SETTINGS.threshold; saveSettings(); });
  container.find('.im_font_size').val(settings.fontSize).on('input change', function () { settings.fontSize = Number($(this).val()) || DEFAULT_SETTINGS.fontSize; saveSettings(); applyOverlaySettings(); });
  container.find('.im_spread').val(settings.spread).on('input change', function () { settings.spread = Number($(this).val()) || DEFAULT_SETTINGS.spread; saveSettings(); paint(); });
  container.find('.im_open_now').on('click', openLatestAssistant);
  container.find('.im_close_now').on('click', closeImmersive);
}

function registerEvents() {
  eventSource.makeLast(event_types.CHARACTER_MESSAGE_RENDERED, (messageId, type) => {
    const message = chat[messageId];
    if (!message || message.is_user || message.is_system) return;
    if (getSettings().autoOpen && ['normal', 'continue', 'swipe'].includes(type || 'normal')) openMessage(Number(messageId));
  });
  eventSource.on(event_types.CHAT_CHANGED, closeImmersive);
}

function registerSlashCommand() {
  SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'immersive',
    callback: () => { openLatestAssistant(); return ''; },
    helpString: 'Open Immersive Mode for the latest assistant message.',
  }));
}

function exposePublicApi() {
  globalThis.SillyTavernImmersiveMode = {
    openLatest: openLatestAssistant,
    openMessage,
    close: closeImmersive,
    debugOpenHtml(html, name = 'Seraphine') {
      createOverlay();
      activeMessageId = -1;
      beats = buildBeatsFromMessage({ mes: String(html || ''), name, is_user: false, is_system: false }, 'debug');
      resetMotion();
      renderBeats();
      overlay.classList.remove('im-closing');
      overlay.style.opacity = '';
      overlay.style.transition = '';
      overlay.classList.add('im-open');
      document.body.classList.add('immersive-mode-active');
      applyOverlaySettings();
      if (!rafStarted) { rafStarted = true; requestAnimationFrame(loop); }
    },
    getState() {
      return { activeMessageId, beats: beats.map(b => stripTags(b.html)), index, offset, open: overlay?.classList.contains('im-open') || false };
    },
    debugSegmentHtml(html) {
      return buildBeatsFromMessage({ mes: String(html || ''), name: 'debug', is_user: false, is_system: false }, 'debug').map(b => stripTags(b.html));
    },
    debugSetSettings(next) {
      Object.assign(getSettings(), next || {});
      saveSettings();
      if (overlay) applyOverlaySettings();
    },
  };
}

async function init() {
  if (initialized) return;
  initialized = true;
  getSettings();
  await addSettingsUi();
  createOverlay();
  addMessageButton();
  attachDelegatedHandlers();
  registerEvents();
  registerSlashCommand();
  exposePublicApi();
  console.log('[Immersive Mode] Loaded.');
}

init().catch(error => {
  console.error('[Immersive Mode] Init failed:', error);
  toastr?.error?.(`Init failed: ${error?.message || error}`, 'Immersive Mode');
});
