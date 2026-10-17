import { extension_settings, renderExtensionTemplateAsync } from '../../../extensions.js';
import { extensionNameFromModuleUrl } from './src/install-path.js';
import { readableColor } from './src/color.js';
import { balanceMarkers } from './src/markers.js';
import { EFFECT_COSTS, PRESETS, costTier, estimateCost } from './src/effects.js';
import { chat, eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';

const EXTENSION_KEY = 'immersiveMode';
const VERSION = '0.3.0';

const DEFAULT_SETTINGS = {
  version: VERSION,
  autoOpen: false,
  splitBigBlocks: true,
  showProgress: true,
  showMessageIds: false,
  showButton: true,
  // free = glide and rest anywhere; snap = glide, then settle onto a line once past `threshold`;
  // step = each wheel notch / key press moves exactly one line. Dragging is always free.
  scrollMode: 'free',
  scrollFeel: 'glide',
  dragSensitivity: 1,
  extractionMode: 'sentence',
  contentMode: 'rp',
  specialCode: false,
  specialHtml: true,
  mobilePerformance: 'auto',
  autoScroll: false,
  autoScrollSpeed: 0.18,
  displayMode: 'rotary',
  position: 'center',
  weight: 'heavy',
  material: 'etched',
  threshold: 0.32,
  fontSize: 38,
  spread: 220,
  fadeOnEnd: true,
  exitAtEnd: true,
  exitAtStart: true,
  showInModeControls: true,
  hideStChrome: false,
  contextPreview: true,
  previewAhead: 2,
  previewBehind: 2,
  preventCodeHtmlCapture: true,
  useRenderedHtml: true,
  skipDetailsBlocks: false,
  shrinkOversizedBeats: true,
  includeAsteriskSeparators: false,
  italicAtomic: false,
  excludeBracketPipes: true,
  mobileSwipeNavigation: true,
  showSendButton: true,
  streamCapture: true,
  emphasisAtomicMax: 140,
  keepMessageColors: true,
  focusBloom: true,
  settleGlow: true,
  edgeBounce: true,
  railStyle: 'liquid',
  glassButtons: true,
  edgeTrace: true,
  lightSweep: true,
  dawnGlow: false,
  inkSettle: true,
  trailingLines: true,
  dialogueWarmth: false,
  focusVignette: false,
  depthSway: true,
  breathing: true,
  finishRing: true,
  backdrop: 'frosted',
  edgeStyle: 'rim',
};

const RAIL_STYLES = ['line', 'ticks', 'osmosis', 'liquid', 'capsule'];
const BACKDROPS = ['frosted', 'dim'];
const EDGE_STYLES = ['rim', 'glow'];
const SCROLL_MODES = ['free', 'snap', 'step'];

const extensionName = extensionNameFromModuleUrl(import.meta.url);

const WEIGHTS = {
  heavy: { wheel: 0.0032, threshold: 0.32, dur: 520 },
  silk: { wheel: 0.0042, threshold: 0.38, dur: 440 },
  fast: { wheel: 0.0058, threshold: 0.34, dur: 320 },
};

// Auto-scroll speed range + exponential mapping (slow at first, ramps up). Shared by the
// in-overlay hold-drag control and the settings-drawer slider so both feel identical.
const AS_MIN_SPEED = 0.03;
const AS_MAX_SPEED = 1.2;
const AS_EXP = 2.4;
function asSpeedToFrac(s) { return clamp(Math.pow((clamp(s, AS_MIN_SPEED, AS_MAX_SPEED) - AS_MIN_SPEED) / (AS_MAX_SPEED - AS_MIN_SPEED), 1 / AS_EXP), 0, 1); }
function asFracToSpeed(f) { return AS_MIN_SPEED + (AS_MAX_SPEED - AS_MIN_SPEED) * Math.pow(clamp(f, 0, 1), AS_EXP); }

let initialized = false;
let host;
let root;
let stage;
let layers = [];
let beatHeights = [];
let beatCenters = [];
let beatScale = [];
let beatOverflow = [];
let fill;
let meta;
let speedHint;
let autoBtn;
let autoScrollRaf = null;
let autoScrollLastTs = 0;
let autoScrollPaused = false;
let autoScrollResumeAt = 0;
let autoScrollCurrentSpeed = 0;
let activeMessageId = null;
let beats = [];
let index = 0;
let visual = 0;
let targetVisual = 0;
let dragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragStartVisual = 0;
let offset = 0;
let transitionRaf = null;
let dragRaf = null;
let glideRaf = null;
let glideVelocity = 0;
let lastGlideTs = 0;
let pointerVel = 0;
let lastMoveY = 0;
let lastMoveTs = 0;
let parkedEnd = false;
let parkedStart = false;
let dragStartParkedEnd = false;
let dragStartParkedStart = false;
let targetIndex = 0;
let lastStreamingUpdate = 0;
let streamingUpdateTimer = null;
let streamingPending = false;
let suppressedStreamingMessageId = null;

// Settings are read on every animation frame, so the defaults/migration pass runs once per
// settings object and later calls return the same object.
let settingsCache = null;
function getSettings() {
  const existing = extension_settings[EXTENSION_KEY];
  if (existing && existing === settingsCache) return existing;
  extension_settings[EXTENSION_KEY] = existing || {};
  const settings = extension_settings[EXTENSION_KEY];
  // Read the pre-0.3 scroll pair before defaults fill `scrollMode` with the new vocabulary.
  const legacyScrollMode = settings.scrollMode;
  const legacyScrollBehavior = settings.scrollBehavior;
  // A fresh install has nothing to migrate; it starts at the current defaults.
  const isFresh = Object.keys(settings).length === 0;
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (settings[key] === undefined) settings[key] = structuredClone(value);
  }
  settings.version = VERSION;
  if (isFresh) settings.displayDefaultsVersion = 6;
  if ((settings.displayDefaultsVersion || 0) < 4) {
    settings.displayMode = 'rotary';
    settings.contextPreview = true;
    if ((Number(settings.threshold) || 0) > 0.38) settings.threshold = 0.32;
    settings.material = 'etched';
    settings.exitAtEnd = true;
    settings.exitAtStart = true;
    settings.displayDefaultsVersion = 4;
  }
  if ((settings.displayDefaultsVersion || 0) < 5) {
    // Migrate old single codeblockGeneral toggle into the new per-type special-block toggles (default off).
    settings.specialCode = !!settings.codeblockGeneral && (settings.contentMode === 'general');
    settings.specialHtml = false;
    settings.displayDefaultsVersion = 5;
  }
  if ((settings.displayDefaultsVersion || 0) < 6) {
    // Scroll Mode (threshold/step) and Scroll Behavior (drag/swipe) both meant "one line per notch"
    // when either was set to step/swipe. They are now one setting with a working snap option.
    const wasStep = legacyScrollMode === 'step' || legacyScrollBehavior === 'swipe';
    settings.scrollMode = wasStep ? 'step' : 'free';
    delete settings.scrollBehavior;
    // HTML cards are how regex/preset output is read without leaving the reader.
    settings.specialHtml = true;
    settings.displayDefaultsVersion = 6;
  }
  if (!SCROLL_MODES.includes(settings.scrollMode)) settings.scrollMode = 'free';
  if (!RAIL_STYLES.includes(settings.railStyle)) settings.railStyle = DEFAULT_SETTINGS.railStyle;
  if (!BACKDROPS.includes(settings.backdrop)) settings.backdrop = DEFAULT_SETTINGS.backdrop;
  if (!EDGE_STYLES.includes(settings.edgeStyle)) settings.edgeStyle = DEFAULT_SETTINGS.edgeStyle;
  settingsCache = settings;
  return settings;
}

function saveSettings() { saveSettingsDebounced(); }
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function stripTags(html) { const div = document.createElement('div'); div.innerHTML = String(html || ''); return div.textContent || ''; }
function escapeHtml(value) { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }

// Message colors. A colored run (model-written <font color>/<span style>, or a preset regex that
// adds classes) becomes a marker pair that survives beat splitting and is restored as a span whose
// color is made readable on the reader background. Structural inline tags keep their meaning.
const STRUCTURAL_INLINE_TAGS = new Set(['MARK', 'U', 'S', 'SMALL', 'SUB', 'SUP']);
let currentPreserved = [];
let htmlBlockStore = [];

// Colors resolved from the live chat DOM, so class-based regex colors are included. Stamped on a
// clone as data-im-color; the parsed (detached) copy cannot compute styles itself.
function stampLiveColors(liveRoot, cloneRoot) {
  const live = liveRoot.querySelectorAll('*');
  const copy = cloneRoot.querySelectorAll('*');
  if (live.length !== copy.length) return;
  for (let i = 0; i < live.length; i++) {
    const el = live[i];
    if (!isAuthoredColorCandidate(el)) continue;
    const own = getComputedStyle(el).color;
    const parent = el.parentElement ? getComputedStyle(el.parentElement).color : '';
    if (own && own !== parent) copy[i].setAttribute('data-im-color', own);
  }
}

function isAuthoredColorCandidate(el) {
  if (el.hasAttribute('color')) return true;
  const style = el.getAttribute('style') || '';
  if (/(^|;)\s*color\s*:/i.test(style)) return true;
  return el.hasAttribute('class') && !el.closest('pre, code');
}

function declaredColor(el) {
  if (el.hasAttribute('data-im-color')) return el.getAttribute('data-im-color');
  if (el.hasAttribute('color')) return el.getAttribute('color');
  const match = (el.getAttribute('style') || '').match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
  return match ? match[1].trim() : '';
}

// Turns any CSS color string into rgb() through the browser, so names and hex all work.
let colorProbe = null;
function cssColorToRgb(value) {
  if (!value) return '';
  if (/^rgba?\(/i.test(value)) return value;
  if (!colorProbe) { colorProbe = document.createElement('span'); colorProbe.style.display = 'none'; document.body.appendChild(colorProbe); }
  colorProbe.style.color = '';
  colorProbe.style.color = value;
  if (!colorProbe.style.color) return '';
  return getComputedStyle(colorProbe).color;
}

function preserveInlineMarkup(div) {
  const settings = getSettings();
  const keepColors = settings.keepMessageColors !== false;
  // Innermost first, so an outer run's text already contains the inner markers.
  // Reverse document order visits children before parents, so an outer run's text already
  // carries the markers of the runs inside it.
  const candidates = [...div.querySelectorAll('*')].reverse();
  for (const el of candidates) {
    if (el.closest('pre, code, kbd, samp')) continue;
    const color = keepColors ? readableColor(cssColorToRgb(declaredColor(el))) : null;
    const structural = STRUCTURAL_INLINE_TAGS.has(el.tagName) ? el.tagName.toLowerCase() : '';
    if (!color && !structural) continue;
    let open = '';
    let close = '';
    if (color) { open += `<span class="im-color" style="color:${color}">`; close = `</span>${close}`; }
    if (structural) { open += `<${structural}>`; close = `</${structural}>${close}`; }
    const idx = currentPreserved.length;
    currentPreserved.push({ open, close });
    // Markers go inside the element around its children, so nested bold/italic still flattens normally.
    el.prepend(document.createTextNode(`@@IM_OPEN_${idx}@@`));
    el.append(document.createTextNode(`@@IM_CLOSE_${idx}@@`));
  }
}

function normalizeMessageText(html, generalMode) {
  const settings = getSettings();
  const div = document.createElement('div');
  div.innerHTML = String(html || '');
  div.querySelectorAll('script, style, .directional-roadway-panel, .mes_reasoning, .mes_reasoning_details').forEach(x => x.remove());
  if (settings.skipDetailsBlocks) div.querySelectorAll('details').forEach(x => x.remove());
  const stripCode = settings.preventCodeHtmlCapture && !settings.specialCode && !settings.specialHtml;
  if (stripCode) div.querySelectorAll('pre, code, kbd, samp').forEach(x => x.remove());
  div.querySelectorAll('br').forEach(x => x.replaceWith('\n'));
  // Colors and structural inline tags become markers before bold/italic flattening reads textContent.
  preserveInlineMarkup(div);
  if (!generalMode) {
    div.querySelectorAll('strong, b').forEach(el => el.replaceWith(document.createTextNode(`==${el.textContent || ''}==`)));
    div.querySelectorAll('em, i').forEach(el => el.replaceWith(document.createTextNode(`*${el.textContent || ''}*`)));
  }
  let text = (div.textContent || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!settings.includeAsteriskSeparators) {
    // ST/markdown horizontal rules like *** should not become blank/awkward immersive beats by default.
    text = text.replace(/(^|\n)\s*\*{3,}\s*(?=\n|$)/g, '$1').replace(/\n{3,}/g, '\n\n').trim();
  }
  if (stripCode) {
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
  if (settings.excludeBracketPipes && !generalMode) text = text.replace(/\[[^\]\n]*\|[^\]\n]*\]/g, ' ').replace(/\s{2,}/g, ' ').trim();
  // Drop empty/whitespace-only inline style wrappers; they should not become blank immersive text.
  text = text.replace(/@@IM_OPEN_(\d+)@@\s*@@IM_CLOSE_\1@@/g, '').trim();
  // Inline HTML markers survive segmentation and are restored in renderBeatHtml.
  return text;
}

function renderBeatHtml(text) {
  if (/^\s*\*{3,}\s*$/.test(String(text || ''))) {
    return getSettings().includeAsteriskSeparators ? '<span class="im-separator">✦ ✦ ✦</span>' : '';
  }
  let safe = escapeHtml(text);
  // Bold/highlight pops
  safe = safe.replace(/==([^=]+)==/g, '<span class="im-pop">$1</span>');
  safe = safe.replace(/\*\*([^*]+)\*\*/g, '<span class="im-pop">$1</span>');
  // Whole-beat italic wrap (RP asterisk action line)
  safe = safe.replace(/^\*([^]+)\*$/g, '<em>$1</em>');
  // Inline italics for any remaining *paired* asterisks (handles general mode markdown emphasis)
  safe = safe.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  // Optional visible markdown separators
  if (getSettings().includeAsteriskSeparators) safe = safe.replace(/(?:^|\s)\*{3,}(?:\s|$)/g, '<span class="im-separator">✦ ✦ ✦</span>');
  // Drop any stray unpaired asterisks so they don't render as literal *
  safe = safe.replace(/\*/g, '');
  // Restore preserved inline HTML (color spans etc.) captured during normalization.
  safe = safe
    .replace(/@@IM_OPEN_(\d+)@@/g, (m, i) => currentPreserved[Number(i)]?.open || '')
    .replace(/@@IM_CLOSE_(\d+)@@/g, (m, i) => currentPreserved[Number(i)]?.close || '');
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
        // Split long non-sentence runs at clause punctuation, but NOT em-dashes (those read as one thought).
        const clausePattern = punctuationMode ? /(?<=,|;|:)\s+/ : /(?<=;|:)\s+/;
        const clauses = sentence.split(clausePattern).map(x => x.trim()).filter(Boolean);
        out.push(...(clauses.length > 1 ? clauses : [sentence]));
      }
    }
  }
  return out;
}

// Finds quoted dialogue, including quotes inside quotes. Models mix styles (“ … " or " … ”), so
// a quote closes on either closing mark. A curly “ inside a quote always opens a nested quote; a
// straight " opens one when it sits before a word with a space in front ( … a "game" … ), and
// otherwise closes. A quote never runs across a blank line or more than one line break; an
// unclosed quote is left as plain text. Returns [{ start, end }] in order, end exclusive.
function findQuoteSpans(src) {
  const spans = [];
  const isOpenerAt = j => /[\s(\[—–]/.test(src[j - 1] ?? ' ') && /[\p{L}\p{N}'‘…]/u.test(src[j + 1] ?? '');
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch !== '"' && ch !== '“') { i++; continue; }
    let depth = 0;
    let breaks = 0;
    let end = -1;
    for (let j = i + 1; j < src.length; j++) {
      const c = src[j];
      if (c === '\n') { breaks++; if (breaks > 1 || src[j + 1] === '\n') break; continue; }
      if (c === '“') depth++;
      else if (c === '”') { if (depth > 0) depth--; else { end = j + 1; break; } }
      else if (c === '"') {
        if (isOpenerAt(j)) depth++;
        else if (depth > 0) depth--;
        else { end = j + 1; break; }
      }
    }
    if (end === -1) { i++; continue; }
    spans.push({ start: i, end });
    i = end;
  }
  return spans;
}

function tokenizeIntoBeats(text) {
  const out = [];
  const src = String(text || '');
  // Dialogue is one beat (quotes found by findQuoteSpans); italic/action spans are atomic only
  // when explicitly enabled and not inside a quote.
  const atoms = findQuoteSpans(src);
  if (getSettings().italicAtomic) {
    const italicRe = /\*[^*]+\*/g;
    let m;
    while ((m = italicRe.exec(src))) {
      const a = m.index;
      const b = a + m[0].length;
      if (!atoms.some(s => a < s.end && b > s.start)) atoms.push({ start: a, end: b });
    }
    atoms.sort((x, y) => x.start - y.start);
  }
  let last = 0;
  for (const span of atoms) {
    const match = { index: span.start, 0: src.slice(span.start, span.end) };
    let before = src.slice(last, match.index).trim();
    let atom = match[0].trim();
    let markerId = null;
    const openMarker = before.match(/^@@IM_OPEN_(\d+)@@$/);
    if (openMarker) {
      markerId = openMarker[1];
      atom = `${before}${atom}`;
      before = '';
    }
    if (before) out.push(...splitLongPlain(before));
    let nextLast = match.index + match[0].length;
    if (markerId !== null) {
      const closeMarker = `@@IM_CLOSE_${markerId}@@`;
      if (src.slice(nextLast).startsWith(closeMarker)) {
        atom = `${atom}${closeMarker}`;
        nextLast += closeMarker.length;
      }
    }
    if (atom.startsWith('*') && atom.endsWith('*')) {
      const inner = atom.slice(1, -1).trim();
      if (inner.length <= (Number(getSettings().emphasisAtomicMax) || DEFAULT_SETTINGS.emphasisAtomicMax)) out.push(atom);
      else out.push(...splitLongPlain(inner).map(piece => `*${piece}*`));
    } else out.push(atom);
    last = nextLast;
  }
  const after = src.slice(last).trim();
  if (after) out.push(...splitLongPlain(after));
  return out.filter(Boolean);
}

function tokenizePlain(text) {
  // General mode: no quote/asterisk atomic handling — just sentence/phrase split.
  return splitLongPlain(String(text || '')).filter(Boolean);
}

function extractSpecialBlocks(rawHtml, opts) {
  // Pull code/HTML blocks out as ordered segments. opts = { code, html }.
  const wantCode = !!opts.code;
  const wantHtml = !!opts.html;
  const segments = [];
  const div = document.createElement('div');
  div.innerHTML = String(rawHtml || '');
  // Only strip <details> when we are NOT rendering HTML blocks (otherwise we render them as cards).
  if (getSettings().skipDetailsBlocks && !wantHtml) div.querySelectorAll('details').forEach(x => x.remove());
  if (wantCode) {
    div.querySelectorAll('pre').forEach(pre => {
      const codeEl = pre.querySelector('code');
      const langClass = (codeEl?.className || pre.className || '').match(/language-([\w+-]+)/);
      const lang = langClass ? langClass[1] : '';
      const code = (codeEl?.textContent ?? pre.textContent ?? '').replace(/\s+$/, '');
      pre.replaceWith(document.createTextNode(`\u0000BLK:code:${lang}\u0001${code}\u0000ENDBLK\u0000`));
    });
  }
  if (wantHtml) {
    // Block-level rendered HTML (regex-built cards, tables, etc.): keep the REAL markup so it renders live.
    div.querySelectorAll('details, table, svg, figure, blockquote, hr').forEach(el => {
      const id = htmlBlockStore.length;
      htmlBlockStore.push(el.outerHTML);
      el.replaceWith(document.createTextNode(`\u0000BLK:html:${id}\u0001\u0000ENDBLK\u0000`));
    });
    // Top-level <div> that is a visual card (its own box styling or block structure inside).
    // A plain <div> around prose, even with colored or bold words, stays prose and is split.
    [...div.children].forEach(el => {
      if (el.tagName === 'DIV' && isCardDiv(el)) {
        const id = htmlBlockStore.length;
        htmlBlockStore.push(el.outerHTML);
        el.replaceWith(document.createTextNode(`\u0000BLK:html:${id}\u0001\u0000ENDBLK\u0000`));
      }
    });
  }
  // Use innerHTML here, not textContent, so inline rendered HTML (<font color>, spans, etc.)
  // survives into normalizeMessageText() after block-level cards are extracted.
  let text = div.innerHTML || '';
  if (wantCode) {
    text = text.replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (m, lang, code) => {
      const kind = (wantHtml && /^(html|xml|svg)$/i.test(lang)) ? 'html-src' : 'code';
      return `\u0000BLK:${kind}:${lang || ''}\u0001${code.replace(/\s+$/, '')}\u0000ENDBLK\u0000`;
    });
  }
  if (wantHtml) {
    // Raw escaped HTML tag-soup blocks left in plain text (e.g. &lt;div&gt;…&lt;/div&gt;) -> render live.
    text = text.replace(/(&lt;(div|table|ul|ol|section|article|details)\b[\s\S]*?&lt;\/\2&gt;)/gi, (m) => {
      const id = htmlBlockStore.length;
      htmlBlockStore.push(unescapeMaybe(m));
      return `\u0000BLK:html:${id}\u0001\u0000ENDBLK\u0000`;
    });
  }
  const parts = text.split(/\u0000ENDBLK\u0000/);
  for (const part of parts) {
    const blkMatch = part.match(/^([\s\S]*?)\u0000BLK:(code|html|html-src):([\w+-]*)\u0001([\s\S]*)$/);
    if (blkMatch) {
      if (blkMatch[1].trim()) segments.push({ type: 'text', text: blkMatch[1] });
      const kind = blkMatch[2];
      if (kind === 'html') {
        segments.push({ type: 'html', html: htmlBlockStore[Number(blkMatch[3])] || '' });
      } else if (kind === 'html-src') {
        segments.push({ type: 'html', html: blkMatch[4] }); // fenced html source -> render it
      } else {
        segments.push({ type: 'code', lang: blkMatch[3] || '', code: blkMatch[4] });
      }
    } else if (part.trim()) {
      segments.push({ type: 'text', text: part });
    }
  }
  return segments;
}

function isCardDiv(el) {
  const style = el.getAttribute('style') || '';
  if (/(background|border|padding|box-shadow|display\s*:\s*(grid|flex)|width|height)\s*:/i.test(style)) return true;
  if (el.querySelector('div, table, ul, ol, details, img, svg, hr, h1, h2, h3, h4, h5, h6, section, article, figure, progress, meter')) return true;
  // A class from a preset regex usually means a styled panel; a class on bare text does not.
  return el.hasAttribute('class') && el.querySelectorAll('br').length >= 2;
}

function unescapeMaybe(s) {
  // textContent already decodes entities for real elements; for escaped tag-soup decode &lt; etc.
  return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'");
}

function getMessageName(message) { if (message?.name) return message.name; return message?.is_user ? 'You' : 'Assistant'; }

// Prefer the rendered .mes_text DOM so SillyTavern's display regex + markdown are already applied
// (e.g. [NPC:MAJOR|...] turned into <details> cards). Falls back to the raw stored mes.
function getMessageSourceHtml(message, messageId) {
  if (getSettings().useRenderedHtml && messageId !== 'debug' && messageId != null) {
    const el = document.querySelector(`#chat .mes[mesid="${messageId}"] .mes_text`);
    if (el && el.innerHTML && el.innerHTML.trim()) {
      if (getSettings().keepMessageColors === false) return el.innerHTML;
      const copy = el.cloneNode(true);
      stampLiveColors(el, copy);
      return copy.innerHTML;
    }
  }
  return message?.mes || '';
}

// Message <style> rules (SillyTavern scopes them under `.mes_text`) re-scoped to the reader's
// HTML cards, so regex/preset cards keep their look inside the reader.
let messageCss = '';
function collectMessageCss(html) {
  if (!/<style/i.test(html)) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  // Only rules SillyTavern already scoped to the message (`.mes_text ...`) are carried over, so
  // message CSS can style its cards but never the reader's own controls.
  const css = [...div.querySelectorAll('style')].map(el => el.textContent || '').join('\n').replace(/@import[^;]*;/gi, '');
  if (typeof CSSStyleSheet !== 'function') return '';
  const sheet = new CSSStyleSheet();
  try { sheet.replaceSync(css); } catch { return ''; }
  const keep = [];
  const scoped = rule => {
    if (rule.cssRules && rule.conditionText !== undefined) {
      const inner = [...rule.cssRules].map(scoped).filter(Boolean).join('\n');
      return inner ? `@${rule.constructor.name === 'CSSMediaRule' ? 'media' : 'supports'} ${rule.conditionText}{${inner}}` : '';
    }
    if (!rule.selectorText) return '';
    const selectors = rule.selectorText.split(',').map(x => x.trim());
    if (!selectors.every(sel => /^\.mes_text\b/.test(sel))) return '';
    return rule.cssText.replace(/\.mes_text\b/g, '.html-card');
  };
  for (const rule of sheet.cssRules) { const text = scoped(rule); if (text) keep.push(text); }
  return keep.join('\n');
}

function applyMessageCss() {
  if (!root) return;
  let el = root.querySelector('style.im-message-css');
  if (!el) { el = document.createElement('style'); el.className = 'im-message-css'; root.appendChild(el); }
  if (el.textContent !== messageCss) el.textContent = messageCss;
}

function buildBeatsFromMessage(message, messageId) {
  const settings = getSettings();
  currentPreserved = [];
  htmlBlockStore = [];
  const sourceHtml = getMessageSourceHtml(message, messageId);
  messageCss = settings.specialHtml ? collectMessageCss(sourceHtml) : '';
  applyMessageCss();
  const generalMode = (settings.contentMode || 'rp') === 'general';
  const wantSpecial = settings.specialCode || settings.specialHtml;
  let rawBeats = [];
  if (wantSpecial) {
    const segments = extractSpecialBlocks(sourceHtml, { code: settings.specialCode, html: settings.specialHtml });
    for (const seg of segments) {
      if (seg.type === 'code') {
        if (String(seg.code).trim()) rawBeats.push({ block: 'code', lang: seg.lang, text: seg.code });
      } else if (seg.type === 'html') {
        if (stripTags(seg.html).trim() || /<(svg|img|hr|table)/i.test(seg.html)) rawBeats.push({ block: 'html', html: seg.html });
      } else {
        const cleaned = normalizeMessageText(seg.text, generalMode);
        const tokens = balanceMarkers(settings.splitBigBlocks ? (generalMode ? tokenizePlain(cleaned) : tokenizeIntoBeats(cleaned)) : [cleaned]);
        for (const t of tokens) if (String(t).trim()) rawBeats.push({ block: '', text: t });
      }
    }
  } else {
    const text = normalizeMessageText(sourceHtml, generalMode);
    const raw = balanceMarkers(settings.splitBigBlocks ? (generalMode ? tokenizePlain(text) : tokenizeIntoBeats(text)) : [text]);
    rawBeats = raw.filter(x => String(x).trim()).map(t => ({ block: '', text: t }));
  }
  return rawBeats
    .filter(b => b.block === 'html' ? true : String(b.text).trim())
    .map((b, i) => {
      if (b.block === 'html') return { html: renderHtmlBeat(b.html), who: '', id: i === 0 ? `#${messageId}` : '', isCode: true, isHtml: true };
      if (b.block === 'code') return { html: renderCodeBeatHtml(b.text, b.lang, b.block), who: '', id: i === 0 ? `#${messageId}` : '', isCode: true };
      return { html: renderBeatHtml(b.text), who: i === 0 ? getMessageName(message) : '', id: i === 0 ? `#${messageId}` : '', isCode: false };
    })
    .filter(b => b.isHtml || b.isCode || stripTags(b.html).trim())
    .map((b, i) => ({
      ...b,
      who: (!b.isCode && !b.isHtml && i === 0) ? getMessageName(message) : b.who,
      id: i === 0 ? `#${messageId}` : '',
      isDialogue: !b.isCode && !b.isHtml && /^["“«„]/.test(stripTags(b.html).trim()),
    }));
}

function renderCodeBeatHtml(code, lang, kind) {
  const tag = kind === 'html' ? (lang || 'html') : (lang || 'code');
  const label = `<span class="code-lang">${escapeHtml(tag)}</span>`;
  return `${label}${escapeHtml(code)}`;
}

// Render a real rendered-HTML block (regex card etc.) live, auto-expanding <details>.
function renderHtmlBeat(html) {
  const wrap = document.createElement('div');
  wrap.innerHTML = String(html || '');
  // Auto-expand collapsible cards so the content is visible without clicking.
  wrap.querySelectorAll('details').forEach(d => d.setAttribute('open', ''));
  // Defang anything executable that might have slipped through.
  wrap.querySelectorAll('script, iframe, object, embed').forEach(x => x.remove());
  // Text colors are made readable on the card's dark surface, unless the card draws its own
  // background behind them (then the author's pairing is kept as is).
  if (getSettings().keepMessageColors !== false) {
    for (const el of wrap.querySelectorAll('*')) {
      const declared = declaredColor(el);
      if (!declared) continue;
      let painted = false;
      for (let n = el; n && n !== wrap; n = n.parentElement) {
        if (/(^|;)\s*background(-color)?\s*:/i.test(n.getAttribute('style') || '')) { painted = true; break; }
      }
      if (painted) continue;
      const readable = readableColor(cssColorToRgb(declared));
      if (readable) { el.style.color = readable; el.removeAttribute('color'); }
    }
  }
  wrap.querySelectorAll('[data-im-color]').forEach(el => el.removeAttribute('data-im-color'));
  return wrap.innerHTML;
}

function shadowCss() {
  return `
    :host{all:initial;position:fixed;inset:48px 0 105px 0;z-index:99999;pointer-events:none;color:#f6f3eb;font-family:"Iowan Old Style","Palatino",Georgia,serif;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;}
    :host(.open){display:block}:host(:not(.open)){display:none}:host(.hide-chrome){inset:0}
    .stage{position:absolute;inset:0;overflow:hidden;perspective:1000px;pointer-events:auto;touch-action:none;user-select:none;cursor:grab}.stage.drag{cursor:grabbing}
    .layer{position:absolute;top:50%;left:50%;width:min(750px,88vw);text-align:center;font-size:var(--im-font-size,38px);line-height:1.55;letter-spacing:.12px;transform-style:preserve-3d;will-change:transform,opacity;backface-visibility:hidden;text-wrap:balance;}
    :host(.position-top) .layer{top:30%}:host(.position-center) .layer{top:50%}:host(.position-bottom) .layer{top:70%}
    .who{display:block;font-family:system-ui,sans-serif;font-size:11px;letter-spacing:2.6px;text-transform:uppercase;color:#7e8796;margin-bottom:12px;font-weight:500}.w{position:relative;display:inline-block;max-width:100%}.txt{display:inline;text-wrap:balance}.glow{position:absolute;inset:0;display:block;text-wrap:balance;color:#fff6e4;-webkit-text-fill-color:#fff6e4;text-shadow:0 0 10px rgba(255,205,130,.55),0 0 26px rgba(255,190,110,.28);opacity:0;pointer-events:none}.im-color{-webkit-text-fill-color:currentColor}.glow .im-color{text-shadow:0 0 12px currentColor}.im-separator{display:inline-block;font-family:system-ui,sans-serif;font-size:.42em;letter-spacing:.65em;color:rgba(214,168,79,.48);vertical-align:middle}.pop,.im-pop{font-weight:650;color:#fff;-webkit-text-fill-color:#fff;background:linear-gradient(120deg,transparent,rgba(255,207,107,.52));background-size:100% 82%;background-repeat:no-repeat;background-position:0 64%;padding:0 .1em;border-radius:4px;text-shadow:0 0 18px rgba(255,207,107,.45)}
    :host(.material-pearl) .txt{background:linear-gradient(180deg,#fff 0%,#e7edf7 55%,#aeb9ca 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;text-shadow:0 0 1px rgba(255,255,255,.7),0 0 10px rgba(230,240,255,.18),0 0 26px rgba(150,180,220,.12)}
    :host(.material-crystal) .txt{background:linear-gradient(176deg,#fff 0%,#f5f9ff 42%,#cfd9eb 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;filter:drop-shadow(0 0 2px rgba(255,255,255,.55)) drop-shadow(0 0 16px rgba(170,205,255,.38))}
    :host(.material-etched) .txt{color:rgba(246,243,235,.92);text-shadow:0 1px 0 rgba(255,255,255,.2),0 -1px 0 rgba(0,0,0,.6),0 0 14px rgba(210,225,255,.14)}
    :host(.material-liquid) .txt{background:linear-gradient(90deg,#eaf6ff 0%,#fff 42%,#d8e8ff 70%,#fff2c6 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;filter:drop-shadow(0 0 3px rgba(255,255,255,.65)) drop-shadow(0 0 22px rgba(130,190,255,.42))}
    .close,.pill{border:1px solid rgba(255,255,255,.08);background:rgba(10,12,18,.45);color:#9aa3b2;border-radius:999px;padding:7px 12px;font-family:system-ui,sans-serif;font-size:12px;cursor:pointer;backdrop-filter:blur(12px);pointer-events:auto}.close:hover,.pill:hover,.pill.active{color:#fff;border-color:rgba(255,255,255,.18)}.close,.pill{transition:transform .28s cubic-bezier(.3,1.6,.5,1),color .18s,border-color .18s}.close:active,.pill:active{transform:scale(.92,.86)}:host(.glass) .close,:host(.glass) .pill{color:#eef3fb;background:linear-gradient(180deg,rgba(255,255,255,.16),rgba(255,255,255,.04));border-color:rgba(255,255,255,.22);box-shadow:inset 0 1px 0 rgba(255,255,255,.45),inset 0 -1px 1px rgba(255,255,255,.08),inset 0 0 12px rgba(255,255,255,.06),0 6px 20px rgba(0,0,0,.35);backdrop-filter:blur(10px) saturate(1.6);-webkit-backdrop-filter:blur(10px) saturate(1.6)}
    .topbar{position:absolute;top:14px;right:16px;z-index:3;display:flex;align-items:center;gap:8px;pointer-events:auto}.toggle-chrome{font-size:15px;line-height:1;padding:6px 11px}.close{font-size:13px;line-height:1;padding:7px 11px}
    .autoscroll{font-size:11px;letter-spacing:.3px}.autoscroll.active{color:#ffcf6b;border-color:rgba(255,207,107,.4);background:rgba(255,207,107,.12)}
    .speed-hint{position:absolute;left:50%;bottom:calc(100% + 8px);transform:translateX(-50%);z-index:4;white-space:nowrap;font-family:system-ui,sans-serif;font-size:12px;color:#ffcf6b;background:rgba(10,12,18,.7);border:1px solid rgba(255,207,107,.3);border-radius:999px;padding:6px 14px;opacity:0;pointer-events:none;transition:opacity 140ms ease;backdrop-filter:blur(10px)}.speed-hint.show{opacity:1}
    .dock{position:absolute;left:0;right:0;bottom:16px;z-index:3;display:flex;flex-direction:column;align-items:center;gap:12px;pointer-events:none}.controls{position:relative;z-index:3;display:flex;align-items:center;gap:8px;font-family:system-ui,sans-serif;opacity:.72;transition:opacity 180ms ease;pointer-events:auto}.controls:hover{opacity:1}:host(:not(.show-controls)) .controls{display:none}.range{width:120px;accent-color:#ffcf6b;pointer-events:auto}
    .hud{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;gap:6px;font-family:system-ui,sans-serif;pointer-events:none}:host(:not(.show-progress)) .hud{display:none}.meta{font-size:10.5px;color:#5d6573;letter-spacing:1px}
    .railbox{position:relative;width:min(320px,46vw);height:22px}.rail{position:absolute;inset:0;display:none}:host(.rail-line) .rail-line,:host(.rail-ticks) .rail-ticks,:host(.rail-osmosis) .rail-osmosis,:host(.rail-liquid) .rail-liquid,:host(.rail-capsule) .rail-capsule{display:block}
    .rail-line .track{position:absolute;left:0;right:0;top:7px;height:2px;background:rgba(255,255,255,.06);border-radius:9px;overflow:hidden}.rail-line .fill{height:100%;width:0;background:linear-gradient(90deg,rgba(180,205,255,.7),#ffcf6b)}
    .dot{position:absolute;top:50%;width:5px;height:5px;margin:-2.5px 0 0 -2.5px;border-radius:50%;background:rgba(255,255,255,.15);transition:background .18s,box-shadow .18s}.dot.on{background:#ffcf6b;box-shadow:0 0 8px rgba(255,207,107,.7)}
    .goo{position:absolute;inset:0;filter:url(#imGoo)}.rail-osmosis .dot{width:8px;height:8px;margin:-4px 0 0 -4px;background:#4b5466;transition:none}.drop{position:absolute;top:50%;width:13px;height:13px;margin:-6.5px 0 0 -6.5px;border-radius:50%;background:#ffcf6b;will-change:left,transform}.shine{position:absolute;top:50%;width:13px;height:13px;margin:-6.5px 0 0 -6.5px;border-radius:50%;background:radial-gradient(circle at 35% 30%,rgba(255,255,255,.85),transparent 45%)}
    .rail-liquid .track{position:absolute;left:0;right:0;top:50%;height:3px;margin-top:-1.5px;border-radius:3px;background:rgba(255,255,255,.08)}.lgoo{position:absolute;inset:0;filter:url(#imGoo2)}.lfill{position:absolute;left:0;top:50%;height:4px;margin-top:-2px;border-radius:4px;background:linear-gradient(90deg,#8fb3ff,#ffcf6b)}.lhead{position:absolute;top:50%;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;background:#ffcf6b}
    .rail-capsule .track{position:absolute;left:0;right:0;top:50%;height:2px;margin-top:-1px;background:rgba(255,255,255,.1);border-radius:2px}.rail-capsule .dot{width:4px;height:4px;margin:-2px 0 0 -2px;background:rgba(255,255,255,.3)}.cap{position:absolute;top:50%;width:34px;height:20px;margin:-10px 0 0 -17px;border-radius:999px;background:linear-gradient(180deg,rgba(255,255,255,.2),rgba(255,255,255,.03));border:1px solid rgba(255,255,255,.3);box-shadow:inset 0 1px 0 rgba(255,255,255,.6),inset 0 -2px 4px rgba(255,255,255,.08),0 4px 14px rgba(0,0,0,.4);backdrop-filter:blur(2px) saturate(1.8) brightness(1.25);-webkit-backdrop-filter:blur(2px) saturate(1.8) brightness(1.25)}
    .svgdefs{position:absolute;width:0;height:0;overflow:hidden}
    .edge{position:absolute;left:0;right:0;height:120px;pointer-events:none;opacity:0;z-index:4}.edge.top{top:0}.edge.bottom{bottom:0}
    .edge .rim{position:absolute;left:0;right:0;height:58px}
    .edge.top .rim{top:0;border-top:1px solid rgba(255,240,215,.8);box-shadow:inset 0 1px 6px rgba(255,236,205,.35);-webkit-mask-image:linear-gradient(180deg,#000,transparent);mask-image:linear-gradient(180deg,#000,transparent)}
    .edge.bottom .rim{bottom:0;border-bottom:1px solid rgba(255,240,215,.8);box-shadow:inset 0 -1px 6px rgba(255,236,205,.35);-webkit-mask-image:linear-gradient(0deg,#000,transparent);mask-image:linear-gradient(0deg,#000,transparent)}
    :host(.edge-rim) .edge .rim{background:linear-gradient(180deg,rgba(255,240,215,.20),rgba(255,230,200,.05) 55%,transparent);backdrop-filter:blur(10px) brightness(1.8) saturate(1.7);-webkit-backdrop-filter:blur(10px) brightness(1.8) saturate(1.7)}
    :host(.edge-rim) .edge.bottom .rim{background:linear-gradient(0deg,rgba(255,240,215,.20),rgba(255,230,200,.05) 55%,transparent)}
    .edge .rim::after{content:"";position:absolute;left:15%;right:15%;height:2px;background:linear-gradient(90deg,transparent,rgba(255,252,245,1),transparent);filter:blur(.4px)}
    .edge.top .rim::after{top:0}.edge.bottom .rim::after{bottom:0}
    :host(.edge-glow) .edge .rim{display:none}
    :host(.edge-glow) .edge.top{background:radial-gradient(ellipse 55% 100% at 50% 0%,rgba(255,214,150,.30),rgba(255,190,120,.08) 50%,transparent 75%)}
    :host(.edge-glow) .edge.bottom{background:radial-gradient(ellipse 55% 100% at 50% 100%,rgba(255,214,150,.30),rgba(255,190,120,.08) 50%,transparent 75%)}
    :host(.perf-mode.edge-rim) .edge .rim{backdrop-filter:none;-webkit-backdrop-filter:none;background:linear-gradient(180deg,rgba(255,240,215,.16),transparent)}
    @media (max-width:900px),(pointer:coarse){:host,:host(.hide-chrome){inset:0;min-height:100dvh}.stage{min-height:100dvh}.layer{width:min(86vw,560px);font-size:var(--im-font-size,32px);line-height:1.62;letter-spacing:.02px}:host(.position-top) .layer{top:24%}:host(.position-center) .layer{top:47%}:host(.position-bottom) .layer{top:65%}.topbar{top:calc(env(safe-area-inset-top,0px) + 10px);right:10px}.close{padding:8px 12px}.dock{bottom:calc(env(safe-area-inset-bottom,0px) + 24px)}.controls{gap:10px;opacity:.82}.pill{padding:9px 13px;font-size:13px;min-width:44px}.railbox{width:min(58vw,260px)}}
    @media (max-width:420px){.layer{width:84vw;font-size:var(--im-font-size,28px);line-height:1.6}.controls{transform:scale(.94)}}
    :host(.perf-mode) .layer{will-change:auto}
    :host(.perf-mode) .txt{text-shadow:none!important;filter:none!important;background:none!important;-webkit-text-fill-color:#eef2f8!important;color:#eef2f8!important}
    :host(.perf-mode) .stage{perspective:none}
        .dawn,.trace{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .6s ease}:host(.dawn-on) .dawn,:host(.trace-on) .trace{opacity:1}
    .ambient{position:absolute;inset:0;pointer-events:none;will-change:transform}
    .mood{position:absolute;inset:0;opacity:0;transition:opacity .9s ease;background:radial-gradient(ellipse 60% 40% at 50% 46%,rgba(255,196,130,.08),transparent 70%)}
    .vignette{position:absolute;inset:0;pointer-events:none;z-index:2;opacity:0;background:radial-gradient(ellipse 75% 70% at 50% 46%,transparent 55%,rgba(0,0,0,.55) 100%)}
    .dawn{overflow:hidden}.dawn>div{position:absolute;left:0;width:100%;height:70%;top:-35%;will-change:transform,opacity}
    .dawn .cool{background:radial-gradient(ellipse 70% 60% at 50% 50%,rgba(110,150,255,.13),rgba(110,150,255,.04) 45%,transparent 72%)}
    .dawn .warm{opacity:0;background:radial-gradient(ellipse 70% 60% at 50% 50%,rgba(255,170,90,.14),rgba(255,150,80,.04) 45%,transparent 72%)}
    .trace{overflow:visible}.trace-track{fill:none;stroke:rgba(255,255,255,.035);stroke-width:1.5}.trace-line{fill:none;stroke:url(#imTrace);stroke-width:1.75;stroke-linecap:round;opacity:.55}.trace-halo{fill:none;stroke:url(#imTrace);stroke-width:7;stroke-linecap:round;opacity:.12}:host(.perf-mode) .trace-halo{display:none}.trace-head{fill:#fff3d6;opacity:0;transition:opacity .3s}
    .trace-head.glow2{fill:rgba(255,214,150,.35)}
    .sweep{position:absolute;inset:0;display:block;text-wrap:balance;pointer-events:none;opacity:0;color:#fff;-webkit-text-fill-color:#fff;text-shadow:0 0 8px rgba(255,244,220,.8),0 0 18px rgba(255,214,150,.45);-webkit-mask-image:linear-gradient(100deg,transparent 42%,#000 50%,transparent 58%);mask-image:linear-gradient(100deg,transparent 42%,#000 50%,transparent 58%);-webkit-mask-size:300% 100%;mask-size:300% 100%;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:100% 0;mask-position:100% 0}.sweep .im-color{-webkit-text-fill-color:#fff}
    :host(.perf-mode) .sweep{text-shadow:none}
    :host(.perf-mode) .goo,:host(.perf-mode) .lgoo{filter:none}:host(.perf-mode) .glow,:host(.perf-mode) .glow .im-color{text-shadow:none}
    :host(.perf-mode.glass) .close,:host(.perf-mode.glass) .pill,:host(.perf-mode) .cap{backdrop-filter:none;-webkit-backdrop-filter:none;background:rgba(40,46,60,.72)}
    .code-beat{box-sizing:border-box;width:min(900px,94vw);text-align:left;font-family:"JetBrains Mono","Fira Code",ui-monospace,Menlo,Consolas,monospace;font-size:clamp(12px,calc(var(--im-font-size,38px) * 0.5),22px);line-height:1.5;white-space:pre;overflow:auto;max-height:var(--im-safe-h,74vh);background:rgba(16,20,28,.82);border:1px solid rgba(140,170,220,.22);border-radius:14px;padding:18px 20px;color:#d7e2f2;box-shadow:0 18px 60px rgba(0,0,0,.5);-webkit-text-fill-color:#d7e2f2;text-shadow:none;background-clip:border-box}
    .code-beat .code-lang{display:block;font-family:system-ui,sans-serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#6f93c8;margin-bottom:10px}
    .html-card{box-sizing:border-box;width:min(900px,94vw);max-height:var(--im-safe-h,78vh);overflow:auto;overscroll-behavior:contain;text-align:left;background:rgba(16,20,28,.58);border:1px solid rgba(140,170,220,.18);border-radius:14px;padding:14px 16px;color:#edf1f7;-webkit-text-fill-color:initial;text-shadow:none;box-shadow:0 18px 60px rgba(0,0,0,.45);font-family:inherit;font-size:calc(var(--im-font-size,38px) * .58);line-height:1.55}
    .html-card details{margin:0}.html-card details>summary{cursor:default;list-style:none}.html-card summary::-webkit-details-marker{display:none}
    .overflow-beat{box-sizing:border-box;max-height:var(--im-safe-h,72vh);overflow:auto;padding-right:10px}
  `;
}

function createOverlay() {
  if (host) return;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${shadowCss()}</style>`
    + '<svg class="svgdefs" aria-hidden="true"><defs>'
    + '<filter id="imGoo"><feGaussianBlur in="SourceGraphic" stdDeviation="2.2" result="b"></feGaussianBlur><feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"></feColorMatrix></filter>'
    + '<filter id="imGoo2"><feGaussianBlur in="SourceGraphic" stdDeviation="2.4" result="b"></feGaussianBlur><feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9"></feColorMatrix></filter>'
    + '</defs></svg>'
    + '<div class="topbar"><button class="pill toggle-chrome" title="Hide/show SillyTavern bars" aria-label="Toggle bars">⤢</button><button class="close" title="Exit" aria-label="Exit">✕</button></div>'
    + '<div class="ambient" aria-hidden="true"><div class="dawn"><div class="cool"></div><div class="warm"></div></div><div class="mood"></div></div>'
    + '<svg class="trace" aria-hidden="true"><defs><linearGradient id="imTrace" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="800"><stop offset="0" stop-color="#8fb3ff"></stop><stop offset="1" stop-color="#ffcf6b"></stop></linearGradient></defs><path class="trace-track l"></path><path class="trace-track r"></path><path class="trace-halo l"></path><path class="trace-halo r"></path><path class="trace-line l"></path><path class="trace-line r"></path><circle class="trace-head glow2 l" r="6"></circle><circle class="trace-head glow2 r" r="6"></circle><circle class="trace-head l" r="2.5"></circle><circle class="trace-head r" r="2.5"></circle></svg>'
    + '<div class="stage"></div><div class="vignette" aria-hidden="true"></div><div class="edge top"><div class="rim"></div></div><div class="edge bottom"><div class="rim"></div></div>'
    + '<div class="dock"><div class="speed-hint">Auto-scroll speed</div>'
    + '<div class="controls"><button class="pill font-down" title="Smaller text">A−</button><button class="pill font-up" title="Larger text">A+</button><button class="pill autoscroll" title="Auto-scroll (tap to toggle; press &amp; drag left/right to set speed)" aria-label="Auto-scroll">▶ auto</button></div>'
    + '<div class="hud"><div class="railbox">'
    + '<div class="rail rail-line"><div class="track"><div class="fill"></div></div></div>'
    + '<div class="rail rail-ticks"></div>'
    + '<div class="rail rail-osmosis"><div class="goo"><div class="drop"></div></div><div class="shine"></div></div>'
    + '<div class="rail rail-liquid"><div class="track"></div><div class="lgoo"><div class="lfill"></div><div class="lhead"></div></div></div>'
    + '<div class="rail rail-capsule"><div class="track"></div><div class="cap"></div></div>'
    + '</div><div class="meta">— / —</div></div></div>';
  stage = root.querySelector('.stage');
  layers = [];
  fill = root.querySelector('.fill');
  meta = root.querySelector('.meta');
  speedHint = root.querySelector('.speed-hint');
  autoBtn = root.querySelector('.autoscroll');
  rail.box = root.querySelector('.railbox');
  rail.ticks = root.querySelector('.rail-ticks');
  rail.goo = root.querySelector('.goo');
  rail.drop = root.querySelector('.drop');
  rail.shine = root.querySelector('.shine');
  rail.lfill = root.querySelector('.lfill');
  rail.lhead = root.querySelector('.lhead');
  rail.capsule = root.querySelector('.rail-capsule');
  rail.cap = root.querySelector('.cap');
  edgeTop = root.querySelector('.edge.top');
  edgeBottom = root.querySelector('.edge.bottom');
  root.querySelector('.close').addEventListener('click', closeImmersive);
  root.querySelector('.font-down').addEventListener('click', () => adjustFontSize(-2));
  root.querySelector('.font-up').addEventListener('click', () => adjustFontSize(2));
  root.querySelector('.toggle-chrome').addEventListener('click', () => { const settings = getSettings(); settings.hideStChrome = !settings.hideStChrome; saveSettings(); applyOverlaySettings(); remeasureAndPaint(); });
  attachAutoScrollControl();
  attachMotionHandlers();
}

function remeasureAndPaint() {
  if (!host?.classList.contains('open')) return;
  measureBeats();
  paint();
}

function resetMotion() {
  // Any move still running belongs to the previous message; stop it before starting over.
  if (transitionRaf) { cancelAnimationFrame(transitionRaf); transitionRaf = null; }
  if (glideRaf) { cancelAnimationFrame(glideRaf); glideRaf = null; }
  if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = null; }
  glideVelocity = 0;
  overscrollHeld = false;
  overscrollEdge = 0;
  index = 0; targetIndex = 0; visual = 0; targetVisual = 0; offset = 0; dragging = false; parkedEnd = false; parkedStart = false; overscroll = 0; overscrollVel = 0; lastDirection = 1; sweptBeat = -1; cancelFadeOnEnd(); resetAmbient(); stopBreath(); lag.pos = 0; lag.vel = 0; fxSpeed = 0; fxPrevVisual = 0; lastCenter = -1; finishShown = false; }
function adjustFontSize(delta) { const settings = getSettings(); settings.fontSize = clamp((Number(settings.fontSize) || DEFAULT_SETTINGS.fontSize) + delta, 18, 64); saveSettings(); applyOverlaySettings(); remeasureAndPaint(); }

function isMobileViewport() {
  // Coarse pointer = touch device (phones, tablets). Portrait desktop monitors use a fine pointer, so they are excluded.
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const shortSide = Math.min(window.innerWidth || 0, window.innerHeight || 0);
  // Tablets up to ~1024 short-side count; large touch desktops do not.
  return !!coarse && shortSide <= 1024;
}

function isPerfActive() {
  const mode = getSettings().mobilePerformance || 'auto';
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return isMobileViewport();
}

function applyOverlaySettings() {
  if (!host) return;
  const settings = getSettings();
  host.classList.toggle('show-progress', !!settings.showProgress);
  host.classList.toggle('show-controls', !!settings.showInModeControls);
  host.classList.toggle('hide-chrome', !!settings.hideStChrome);
  host.classList.toggle('glass', !!settings.glassButtons);
  host.classList.toggle('trace-on', !!settings.edgeTrace);
  host.classList.toggle('dawn-on', !!settings.dawnGlow);
  for (const style of EDGE_STYLES) host.classList.toggle(`edge-${style}`, settings.edgeStyle === style);
  host.classList.remove('material-pearl', 'material-crystal', 'material-etched', 'material-liquid');
  host.classList.add(`material-${settings.material || 'pearl'}`);
  host.classList.remove('position-top', 'position-center', 'position-bottom');
  host.classList.add(`position-${settings.position || 'center'}`);
  for (const style of RAIL_STYLES) host.classList.toggle(`rail-${style}`, settings.railStyle === style);
  host.classList.toggle('perf-mode', isPerfActive());
  host.style.setProperty('--im-font-size', `${Number(settings.fontSize) || DEFAULT_SETTINGS.fontSize}px`);
  root?.querySelector('.toggle-chrome')?.classList.toggle('active', !!settings.hideStChrome);
  document.body.classList.toggle('im-hide-st-chrome', !!settings.hideStChrome && host.classList.contains('open'));
  // Frosted glass blurs the whole page behind the reader; performance mode keeps the plain dim.
  document.body.classList.toggle('im-backdrop-frosted', settings.backdrop === 'frosted' && !isPerfActive());
  invalidateLayers();
}

// ---------- Layers ----------
// A layer keeps the beat it shows for as long as that beat stays in view, so scrolling only moves
// layers; markup is written when a beat first comes into view (or after content/settings change).

function invalidateLayers() {
  for (const layer of layers) layer._beat = -1;
  // Rewritten layers lose their breathing; pick it up again once the new markup is in place.
  if (breath.anim || breath.timer) { stopBreath(); if (host?.classList.contains('open')) setTimeout(() => { if (!dragging && !transitionRaf && !glideRaf) scheduleBreath(); }, 0); }
}

function beatInnerHtml(beat, withId) {
  const id = withId && beat.id ? `<span class="who">${escapeHtml(beat.id)}</span>` : '';
  if (beat.isHtml || beat.isCode) return `${beat.html}${id}`;
  const who = beat.who ? `<span class="who">${escapeHtml(beat.who)}</span>` : '';
  return `${who}<span class="w"><span class="txt">${beat.html}</span><span class="glow" aria-hidden="true">${beat.html}</span><span class="sweep" aria-hidden="true">${beat.html}</span></span>${id}`;
}

function layerClassFor(beat) {
  if (beat.isHtml) return 'layer html-card';
  if (beat.isCode) return 'layer code-beat';
  return 'layer';
}

function setStyle(layer, key, value) {
  if (layer._s[key] === value) return;
  layer._s[key] = value;
  layer.style[key] = value;
}

function assignLayers(wanted) {
  const keep = new Set();
  const free = [];
  for (const layer of layers) {
    if (layer._beat >= 0 && wanted.includes(layer._beat) && !keep.has(layer._beat)) keep.add(layer._beat);
    else free.push(layer);
  }
  const assigned = new Map();
  for (const layer of layers) if (keep.has(layer._beat) && !assigned.has(layer._beat)) assigned.set(layer._beat, layer);
  for (const beatIndex of wanted) {
    if (assigned.has(beatIndex)) continue;
    let layer = free.pop();
    if (!layer) {
      layer = document.createElement('div');
      layer._s = {};
      stage.appendChild(layer);
      layers.push(layer);
    }
    writeLayer(layer, beatIndex);
    assigned.set(beatIndex, layer);
  }
  for (const layer of free) {
    if (breath.layer === layer) stopBreath();
    if (layer._beat === -2) continue;
    layer._beat = -2;
    setStyle(layer, 'visibility', 'hidden');
  }
  return assigned;
}

function writeLayer(layer, beatIndex) {
  const beat = beats[beatIndex];
  layer._beat = beatIndex;
  layer.className = layerClassFor(beat) + (beatOverflow[beatIndex] ? ' overflow-beat' : '');
  layer.innerHTML = beatInnerHtml(beat, !!getSettings().showMessageIds);
  layer._glow = layer.querySelector('.glow');
  layer._sweep = layer.querySelector('.sweep');
  layer._w = layer.querySelector('.w');
  if (breath.layer === layer) stopBreath();
  layer._glowOpacity = '';
  layer.scrollTop = 0;
  const flat = beat.isCode || beat.isHtml;
  const shrink = (!flat && beatScale[beatIndex] != null) ? beatScale[beatIndex] : 1;
  layer.style.fontSize = (!flat && shrink < 1) ? `calc(var(--im-font-size, 38px) * ${shrink.toFixed(3)})` : '';
}

// ---------- Measuring ----------
// Heights are cached by beat content and layout, so streaming only measures beats that changed.
let measureCache = new Map();
let measureLayoutKey = '';
let beatShift = [];
let safeTop = 0;
let safeBottom = 0;
let anchorY = 0;

function measureBeats() {
  beatHeights = [];
  beatCenters = [];
  beatScale = [];
  beatOverflow = [];
  beatShift = [];
  invalidateLayers();
  if (!stage || !beats.length) return;
  const settings = getSettings();
  const shrinkOn = settings.shrinkOversizedBeats !== false;
  const stageH = stage.clientHeight || window.innerHeight || 800;
  const measurer = document.createElement('div');
  measurer.className = 'layer';
  measurer.style.visibility = 'hidden';
  measurer.style.transform = 'none';
  stage.appendChild(measurer);
  // The text anchor comes from the stylesheet (Top / Center / Bottom, desktop or phone).
  anchorY = parseFloat(getComputedStyle(measurer).top) || stageH / 2;
  // Keep the focal beat clear of the top buttons and the bottom controls/progress rail, measured
  // from where they actually are (they move between desktop and phone layouts).
  const stageRect = stage.getBoundingClientRect();
  const visibleRect = sel => { const el = root.querySelector(sel); const r = el && getComputedStyle(el).display !== 'none' ? el.getBoundingClientRect() : null; return r && r.height ? r : null; };
  const topbar = visibleRect('.topbar');
  const lowest = [visibleRect('.controls'), visibleRect('.hud')].filter(Boolean).reduce((top, r) => Math.min(top, r.top), stageRect.bottom);
  // The edge light bars sit on the safe-area edges, right where the text stops.
  const margin = 10;
  safeTop = topbar ? topbar.bottom - stageRect.top + margin : margin;
  safeBottom = Math.max(safeTop + 120, lowest - stageRect.top - margin);
  const safeH = safeBottom - safeTop;
  host.style.setProperty('--im-safe-h', `${Math.floor(safeH)}px`);
  const layoutKey = [settings.fontSize, stage.clientWidth, Math.floor(safeH), shrinkOn, settings.showMessageIds, host.className].join('|');
  if (layoutKey !== measureLayoutKey) { measureCache = new Map(); measureLayoutKey = layoutKey; }
  const maxH = safeH * 0.96;
  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    const key = `${layerClassFor(beat)}\u0000${beat.who}\u0000${beat.id}\u0000${beat.html}`;
    let m = measureCache.get(key);
    if (!m) {
      measurer.style.fontSize = '';
      measurer.className = layerClassFor(beat);
      measurer.innerHTML = beatInnerHtml(beat, !!settings.showMessageIds);
      let h = measurer.offsetHeight || (Number(settings.fontSize) || DEFAULT_SETTINGS.fontSize) * 1.55;
      let scale = 1;
      let overflow = false;
      // Shrink an oversized prose beat's font until it fits the safe area, then re-measure.
      if (shrinkOn && !beat.isHtml && !beat.isCode && h > maxH) {
        scale = Math.max(0.5, maxH / h);
        measurer.style.fontSize = `calc(var(--im-font-size, 38px) * ${scale.toFixed(3)})`;
        h = measurer.offsetHeight || h;
      }
      // Whatever still does not fit scrolls inside itself.
      if (!beat.isHtml && !beat.isCode && h > maxH) { overflow = true; h = maxH; }
      m = { h, scale, overflow };
      measureCache.set(key, m);
    }
    beatScale[i] = m.scale;
    beatHeights[i] = m.h;
    beatOverflow[i] = m.overflow;
    // How far this beat must move from the anchor to stay fully inside the safe area.
    const top = anchorY - m.h / 2;
    const bottom = anchorY + m.h / 2;
    let shift = 0;
    if (m.h >= safeH) shift = (safeTop + safeH / 2) - anchorY;
    else if (bottom > safeBottom) shift = safeBottom - bottom;
    else if (top < safeTop) shift = safeTop - top;
    beatShift[i] = shift;
  }
  measurer.remove();
  buildAmbient();
  // gap is the even breathing room between any two adjacent beats, independent of beat size
  const gap = Math.max(28, (Number(settings.spread) || DEFAULT_SETTINGS.spread) - (Number(settings.fontSize) || DEFAULT_SETTINGS.fontSize) * 2.2);
  let cursor = 0;
  for (let i = 0; i < beats.length; i++) {
    const half = beatHeights[i] / 2;
    cursor += half;
    beatCenters[i] = cursor;
    cursor += half + gap;
  }
}

// Pixel offset of a fractional beat position from the current center beat, using measured heights.
function centerPixelFor(pos) {
  const spread = Number(getSettings().spread) || DEFAULT_SETTINGS.spread;
  if (!beatCenters.length) return pos * spread;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const frac = pos - lo;
  const at = i => {
    if (i < 0) return (beatCenters[0] ?? 0) - (-i) * spread;
    if (i >= beatCenters.length) return (beatCenters[beatCenters.length - 1] ?? 0) + (i - (beatCenters.length - 1)) * spread;
    return beatCenters[i];
  };
  if (lo === hi) return at(lo);
  return at(lo) + (at(hi) - at(lo)) * frac;
}

// Edge-aware placement: the whole stack slides so the focal beat stays on screen, blending
// between neighbouring beats so the slide is continuous while scrolling.
function shiftFor(pos) {
  if (!beatShift.length) return 0;
  const p = clamp(pos, 0, beatShift.length - 1);
  const lo = Math.floor(p);
  const hi = Math.ceil(p);
  const a = beatShift[lo] || 0;
  const b = beatShift[hi] || 0;
  return a + (b - a) * (p - lo);
}

// ---------- Painting ----------

function renderLayer(layer, beatIndex, pos, shift) {
  const beat = beats[beatIndex];
  const settings = getSettings();
  const d = beatIndex - pos;
  const displayMode = settings.displayMode || 'rotary';
  const contextPreview = !!settings.contextPreview || displayMode === 'teleprompter' || displayMode === 'rotary';
  const dn = Math.abs(d);
  let opacity;
  if (contextPreview) {
    const activeCurve = Math.exp(-Math.pow(dn / 0.48, 2));
    const baseGhost = displayMode === 'spotlight' ? 0.12 : displayMode === 'rotary' ? 0.24 : 0.30;
    opacity = Math.min(1, activeCurve + baseGhost * Math.exp(-dn / 1.35));
  } else opacity = Math.exp(-Math.pow(dn / 0.40, 2));
  let y = centerPixelFor(beatIndex) - centerPixelFor(pos) + shift;
  // Trailing lines: neighbours follow the focal line a beat late, as if hung on a string.
  if (settings.trailingLines && !host.classList.contains('perf-mode')) y += (centerPixelFor(visual) - centerPixelFor(lag.pos)) * 0.35 * Math.min(1, dn);
  const flat = beat.isCode || beat.isHtml; // cards/code stay flat & readable, no rotary tilt
  const scale = flat ? (0.96 + 0.04 * Math.min(1, opacity * 4)) : (displayMode === 'teleprompter' ? 0.82 + 0.18 * Math.min(1, opacity * 3) : 0.9 + 0.1 * Math.min(1, opacity * 4));
  const rot = (!flat && displayMode === 'rotary') ? ` rotateX(${(clamp(d, -2, 2) * -34).toFixed(2)}deg)` : '';
  setStyle(layer, 'transform', `translate3d(-50%, calc(-50% + ${y.toFixed(1)}px), 0)${rot} scale(${scale.toFixed(3)})`);
  setStyle(layer, 'opacity', opacity.toFixed(3));
  // Blur is the costliest effect here; quantized so it is only re-applied when it visibly changes.
  const blur = (!flat && contextPreview && dn > 0.25) ? Math.round(Math.min(2.2, dn * 1.15) * 5) / 5 : 0;
  setStyle(layer, 'filter', blur ? `blur(${blur}px)` : 'none');
  setStyle(layer, 'visibility', opacity < 0.002 ? 'hidden' : 'visible');
  if (layer._glow) {
    // Focus bloom: the line warms up as it nears the center and cools as it leaves.
    const glow = settings.focusBloom ? (0.6 * Math.exp(-Math.pow(dn / 0.32, 2))).toFixed(2) : '0';
    if (layer._glowOpacity !== glow) { layer._glowOpacity = glow; layer._glow.style.opacity = glow; }
  }
}

function paint() {
  if (!host?.classList.contains('open') || !beats.length) return;
  const settings = getSettings();
  const pos = visual + overscroll;
  const center = clamp(Math.round(pos), 0, beats.length - 1);
  if (sweptBeat >= 0 && Math.abs(visual - sweptBeat) > 0.6) sweptBeat = -1;
  let ahead = Math.max(0, Number(settings.previewAhead) || 0);
  let behind = Math.max(0, Number(settings.previewBehind) || 0);
  if (settings.position === 'bottom') ahead = Math.min(ahead, 1);
  if (settings.position === 'top') behind = Math.min(behind, 1);
  const wanted = [];
  for (let r = -behind; r <= ahead; r++) { const i = center + r; if (i >= 0 && i < beats.length) wanted.push(i); }
  const assigned = assignLayers(wanted);
  const shift = shiftFor(pos);
  for (const [beatIndex, layer] of assigned) renderLayer(layer, beatIndex, pos, shift);
  onCenter(center, assigned.get(center), settings);
  if (breath.anim && Math.abs(visual - breath.beat) > 0.01) stopBreath();
  if (finishShown && visual < beats.length - 1.5) finishShown = false;
  const progress = beats.length > 1 ? visual / (beats.length - 1) : 1;
  fill.style.width = `${clamp(progress, 0, 1) * 100}%`;
  const label = `${Math.round(visual) + 1} / ${beats.length}`;
  if (meta.textContent !== label) meta.textContent = label;
  const glow = settings.edgeBounce ? clamp((overscroll * overscrollEdge) / 0.22, 0, 1) : 0;
  edgeTop.style.opacity = overscrollEdge < 0 ? glow.toFixed(3) : '0';
  edgeBottom.style.opacity = overscrollEdge > 0 ? glow.toFixed(3) : '0';
  startFxLoop();
}

// ---------- Effects loop: progress rail springs and edge bounce ----------
const rail = { pos: 0, vel: 0, head: 0, headVel: 0, count: -1, dots: [] };

// ---------- Line effects: ink settle, dialogue warmth, breathing, finish ring ----------
const lag = { pos: 0, vel: 0 };
let fxSpeed = 0;
let fxPrevVisual = 0;
let lastCenter = -1;
let moodOn = '';
let vignetteOn = '';
let swayOn = '';
let finishShown = false;
const breath = { timer: null, anim: null, beat: -1, layer: null };

function onCenter(center, layer, settings) {
  // Dialogue warmth: the center warms slightly while the focal line is speech.
  const mood = settings.dialogueWarmth && beats[center]?.isDialogue ? '1' : '0';
  if (mood !== moodOn) { moodOn = mood; const el = root?.querySelector('.mood'); if (el) el.style.opacity = mood; }
  if (center === lastCenter) return;
  lastCenter = center;
  // Ink settle: the arriving line sharpens from a hair of blur, skipped while flinging past lines.
  if (settings.inkSettle && layer?._w && fxSpeed < 0.06 && !host.classList.contains('perf-mode') && typeof layer._w.animate === 'function') {
    layer._w.animate([{ filter: 'blur(.9px)', transform: 'scale(.985)', opacity: 0.75 }, { filter: 'blur(0px)', transform: 'scale(1)', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(.2,.7,.3,1)' });
  }
}

function stopBreath() {
  if (breath.timer) { clearTimeout(breath.timer); breath.timer = null; }
  if (breath.anim) { breath.anim.cancel(); breath.anim = null; }
  breath.layer = null;
  breath.beat = -1;
}

// Breathing: after resting on a line, its glow rises and falls very slowly until you move.
function scheduleBreath() {
  stopBreath();
  if (!getSettings().breathing) return;
  const c = Math.round(visual);
  if (Math.abs(visual - c) > 0.12) return;
  breath.beat = c;
  breath.timer = setTimeout(() => {
    breath.timer = null;
    const layer = layers.find(l => l._beat === c);
    const glow = layer?._glow;
    if (!glow || Math.abs(visual - c) > 0.01 || typeof glow.animate !== 'function') return;
    const base = Number(layer._glowOpacity) || 0;
    breath.layer = layer;
    breath.anim = glow.animate([{ opacity: base }, { opacity: Math.min(1, base + 0.22) }, { opacity: base }], { duration: 4500, iterations: Infinity, easing: 'ease-in-out' });
  }, 2400);
}

// Finish ring: resting on the last line makes the edge trace glow once.
function playFinishRing() {
  const settings = getSettings();
  if (!settings.finishRing || !settings.edgeTrace || finishShown || !atEndBoundary() || !ambient.els) return;
  finishShown = true;
  for (const line of ambient.els.lines) {
    if (typeof line.animate === 'function') line.animate([{ opacity: 0.55, strokeWidth: 1.75 }, { opacity: 1, strokeWidth: 3, offset: 0.35 }, { opacity: 0.55, strokeWidth: 1.75 }], { duration: 1400, easing: 'ease-in-out' });
  }
}

// ---------- Ambient progress: edge trace and dawn ----------
// Both follow reading progress (0 at the first line, 1 at the last) through a soft spring, so they
// drift rather than jump. Both only use cheap properties: stroke offset, transform, opacity.
const ambient = { p: 0, v: 0, w: 0, h: 0, lenL: 0, lenR: 0, els: null, drawn: '' };

function buildAmbient() {
  if (!root || !stage) return;
  const svg = root.querySelector('.trace');
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  if (!svg || !w || !h) return;
  if (!ambient.els) {
    ambient.els = {
      svg,
      lines: [...svg.querySelectorAll('.trace-line')],
      halos: [...svg.querySelectorAll('.trace-halo')],
      tracks: [...svg.querySelectorAll('.trace-track')],
      heads: [...svg.querySelectorAll('.trace-head')],
      grad: svg.querySelector('#imTrace'),
      cool: root.querySelector('.dawn .cool'),
      warm: root.querySelector('.dawn .warm'),
    };
  }
  if (ambient.w === w && ambient.h === h) return;
  ambient.w = w;
  ambient.h = h;
  ambient.drawn = '';
  const { lines, tracks, halos, grad } = ambient.els;
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  grad.setAttribute('y2', h);
  // Two halves start together at the top center, run down each side, and meet at the bottom center.
  const i = 1.5;
  const r = 14;
  const m = w / 2;
  const left = `M${m},${i} L${i + r},${i} Q${i},${i} ${i},${i + r} L${i},${h - i - r} Q${i},${h - i} ${i + r},${h - i} L${m},${h - i}`;
  const right = `M${m},${i} L${w - i - r},${i} Q${w - i},${i} ${w - i},${i + r} L${w - i},${h - i - r} Q${w - i},${h - i} ${w - i - r},${h - i} L${m},${h - i}`;
  [left, right].forEach((d, k) => { lines[k].setAttribute('d', d); tracks[k].setAttribute('d', d); halos[k].setAttribute('d', d); });
  ambient.lenL = lines[0].getTotalLength();
  ambient.lenR = lines[1].getTotalLength();
  lines[0].style.strokeDasharray = halos[0].style.strokeDasharray = `${ambient.lenL}`;
  lines[1].style.strokeDasharray = halos[1].style.strokeDasharray = `${ambient.lenR}`;
}

function readingProgress() { return beats.length > 1 ? clamp(visual / (beats.length - 1), 0, 1) : 1; }

function drawAmbient(settings) {
  const els = ambient.els;
  if (!els || (!settings.edgeTrace && !settings.dawnGlow)) return;
  const p = clamp(ambient.p, 0, 1);
  const key = p.toFixed(4);
  if (key === ambient.drawn) return;
  ambient.drawn = key;
  if (settings.edgeTrace && ambient.lenL) {
    els.lines[0].style.strokeDashoffset = els.halos[0].style.strokeDashoffset = `${(ambient.lenL * (1 - p)).toFixed(1)}`;
    els.lines[1].style.strokeDashoffset = els.halos[1].style.strokeDashoffset = `${(ambient.lenR * (1 - p)).toFixed(1)}`;
    const points = [els.lines[0].getPointAtLength(ambient.lenL * p), els.lines[1].getPointAtLength(ambient.lenR * p)];
    const headOpacity = p > 0.004 && p < 0.996 ? '.85' : '0';
    // Heads come in pairs (soft glow + bright dot) for the left and right halves.
    els.heads.forEach((head, k) => {
      const pt = points[k % 2];
      head.setAttribute('cx', pt.x.toFixed(1));
      head.setAttribute('cy', pt.y.toFixed(1));
      head.style.opacity = headOpacity;
    });
  }
  if (settings.dawnGlow) {
    // The glow sinks from the top to the bottom of the screen and warms from blue to amber.
    // Moves in 2 px steps and fades in 2% steps: the glow is a huge soft gradient, so the steps
    // are invisible, but each one costs a repaint of the whole screen.
    const y = `translate3d(0, ${(Math.round(p * ambient.h / 2) * 2)}px, 0)`;
    const warm = (Math.round(p * 50) / 50).toFixed(2);
    if (els.cool.style.transform !== y) els.cool.style.transform = els.warm.style.transform = y;
    if (els.warm.style.opacity !== warm) { els.warm.style.opacity = warm; els.cool.style.opacity = (1 - Number(warm)).toFixed(2); }
  }
}

function resetAmbient() { ambient.p = readingProgress(); ambient.v = 0; ambient.drawn = ''; }
let edgeTop;
let edgeBottom;
let overscroll = 0;
let overscrollVel = 0;
let overscrollHeld = false;
// The edge that was hit (-1 top, 1 bottom). The spring may swing a little past rest; that swing
// is part of the same bounce, so only this edge ever lights up.
let overscrollEdge = 0;
let fxRaf = null;
let fxLastTs = 0;
let lastDirection = 1;

let inFx = false;
function startFxLoop() {
  if (fxRaf || inFx || !host?.classList.contains('open')) return;
  fxLastTs = performance.now();
  fxRaf = requestAnimationFrame(fxStep);
}

function buildRailDots() {
  if (rail.count === beats.length) return;
  rail.count = beats.length;
  for (const dot of rail.dots) dot.remove();
  rail.dots = [];
  // One dot per line; long messages share dots so the rail never turns into a smear.
  const count = Math.min(beats.length, 24);
  for (const parent of [rail.ticks, rail.goo, rail.capsule]) {
    const before = parent === rail.goo ? rail.drop : parent === rail.capsule ? rail.cap : null;
    for (let i = 0; i < count; i++) {
      const dot = document.createElement('div');
      dot.className = 'dot';
      dot._k = i;
      dot._of = count;
      parent.insertBefore(dot, before);
      rail.dots.push(dot);
    }
  }
}

function fxStep(now) {
  fxRaf = null;
  if (!host?.classList.contains('open') || !beats.length) return;
  const dt = Math.min(2.2, Math.max(0.5, (now - fxLastTs) / 16.67));
  fxLastTs = now;
  const settings = getSettings();
  let edgeMoving = false;
  let railMoving = false;
  inFx = true;
  try {
    // Edge bounce: overscroll springs back to zero once nothing is holding it out.
    if (!overscrollHeld && (Math.abs(overscroll) > 0.0005 || Math.abs(overscrollVel) > 0.0005)) {
      overscrollVel += -overscroll * 0.16 * dt;
      overscrollVel *= Math.pow(0.72, dt);
      const before = overscroll;
      overscroll += overscrollVel * dt;
      // Crossing the rest point damps the swing hard, so the text settles instead of wobbling.
      if (before && Math.sign(overscroll) !== Math.sign(before)) { overscroll *= 0.35; overscrollVel *= 0.3; }
      if (Math.abs(overscroll) < 0.0005 && Math.abs(overscrollVel) < 0.0005) { overscroll = 0; overscrollVel = 0; }
      edgeMoving = true;
    }
    const target = visual;
    rail.vel += (target - rail.pos) * 0.16 * dt;
    rail.vel *= Math.pow(0.72, dt);
    rail.pos += rail.vel * dt;
    rail.headVel += (target - rail.head) * 0.09 * dt;
    rail.headVel *= Math.pow(0.78, dt);
    rail.head += rail.headVel * dt;
    railMoving = Math.abs(target - rail.pos) > 0.0005 || Math.abs(rail.vel) > 0.0005 || Math.abs(target - rail.head) > 0.0005 || Math.abs(rail.headVel) > 0.0005;
    if (!railMoving) { rail.pos = target; rail.head = target; rail.vel = 0; rail.headVel = 0; }
    const progress = readingProgress();
    ambient.v += (progress - ambient.p) * 0.12 * dt;
    ambient.v *= Math.pow(0.78, dt);
    ambient.p += ambient.v * dt;
    if (Math.abs(progress - ambient.p) < 0.0004 && Math.abs(ambient.v) < 0.0004) { ambient.p = progress; ambient.v = 0; }
    else railMoving = true;
    drawAmbient(settings);
    // Scroll speed (lines per frame, smoothed) and the lagging position used by trailing lines and sway.
    fxSpeed = fxSpeed * 0.82 + (Math.abs(visual - fxPrevVisual) / dt) * 0.18;
    fxPrevVisual = visual;
    if (fxSpeed < 0.00005) fxSpeed = 0;
    lag.vel += (visual - lag.pos) * 0.14 * dt;
    lag.vel *= Math.pow(0.76, dt);
    lag.pos += lag.vel * dt;
    const lagMoving = Math.abs(visual - lag.pos) > 0.0005 || Math.abs(lag.vel) > 0.0005;
    if (!lagMoving) { lag.pos = visual; lag.vel = 0; }
    if (lagMoving || fxSpeed) railMoving = true;
    const vignette = settings.focusVignette ? clamp((fxSpeed - 0.004) * 14, 0, 0.85).toFixed(2) : '0';
    if (vignette !== vignetteOn) { vignetteOn = vignette; const el = root?.querySelector('.vignette'); if (el) el.style.opacity = vignette; }
    // Snaps to exactly 0 once the lag has settled, so no sub-pixel offset is left behind.
    const swayPx = lagMoving ? -(centerPixelFor(visual) - centerPixelFor(lag.pos)) * 0.3 : 0;
    const sway = settings.depthSway && Math.abs(swayPx) >= 0.05 ? `translate3d(0, ${swayPx.toFixed(1)}px, 0)` : '';
    if (sway !== swayOn) { swayOn = sway; const el = root?.querySelector('.ambient'); if (el) el.style.transform = sway; }
    if (lagMoving && settings.trailingLines && !host.classList.contains('perf-mode')) edgeMoving = true;
    if (edgeMoving) paint();
    if (settings.showProgress) drawRail(settings.railStyle, Math.max(1, beats.length - 1));
  } finally {
    inFx = false;
  }
  if (edgeMoving || railMoving) fxRaf = requestAnimationFrame(fxStep);
}

function drawRail(style, last) {
  if (style === 'line' || !rail.box) return;
  buildRailDots();
  const width = rail.box.clientWidth || 300;
  const x = p => (clamp(p, -0.4, last + 0.4) / last) * width;
  const frac = p => clamp(p, 0, last) / last;
  const current = clamp(Math.round(rail.pos), 0, last);
  const dotOn = dot => Math.round(frac(current) * (dot._of - 1)) === dot._k;
  for (const dot of rail.dots) {
    const left = `${(dot._k / Math.max(1, dot._of - 1)) * width}px`;
    if (dot._left !== left) { dot._left = left; dot.style.left = left; }
    const on = (style === 'ticks' || style === 'capsule') && dotOn(dot);
    if (dot._on !== on) { dot._on = on; dot.classList.toggle('on', on); }
  }
  if (style === 'osmosis') {
    const speed = Math.abs(rail.vel);
    const sx = 1 + Math.min(2.6, speed * 14);
    const t = `scale(${sx.toFixed(3)}, ${(1 / Math.sqrt(sx)).toFixed(3)})`;
    rail.drop.style.left = rail.shine.style.left = `${x(rail.pos).toFixed(1)}px`;
    rail.drop.style.transform = rail.shine.style.transform = t;
  } else if (style === 'liquid') {
    const hx = x(rail.head);
    rail.lfill.style.width = `${Math.max(0, hx).toFixed(1)}px`;
    rail.lhead.style.left = `${hx.toFixed(1)}px`;
    const s = Math.abs(rail.headVel);
    rail.lhead.style.transform = `scale(${(1 + s * 6).toFixed(3)}, ${(1 / (1 + s * 4)).toFixed(3)})`;
  } else if (style === 'capsule') {
    const s = Math.abs(rail.vel);
    rail.cap.style.left = `${x(rail.pos).toFixed(1)}px`;
    rail.cap.style.transform = `scale(${(1 + Math.min(0.9, s * 6)).toFixed(3)}, ${(1 - Math.min(0.3, s * 2.2)).toFixed(3)})`;
  }
}

// Push the stack past an edge. `amount` is in beats; it springs back on its own.
// `strength` is 0..1. A full push overshoots about half a line and springs back, like the demo.
// Pushes in a burst (trackpad, fast wheel) add up, capped, so harder pushes bounce further.
function kickEdge(direction, strength = 0.6) {
  if (!getSettings().edgeBounce) return;
  overscrollEdge = direction;
  const v = direction * (0.1 + 0.26 * clamp(strength, 0, 1));
  if (Math.sign(overscrollVel) === direction) overscrollVel = direction * Math.min(0.42, Math.abs(overscrollVel) + Math.abs(v) * 0.45);
  else overscrollVel = v;
  startFxLoop();
}

// ---------- Settle glow and snap ----------
// Light sweep: one soft band of light crosses a line when you land on it. It plays once per
// arrival; resting on the same line again does not repeat it.
let sweptBeat = -1;
function playLightSweep() {
  if (!getSettings().lightSweep) return;
  const c = Math.round(visual);
  if (Math.abs(visual - c) > 0.12 || c === sweptBeat) return;
  const layer = layers.find(l => l._beat === c);
  const sweep = layer?._sweep;
  if (!sweep || typeof sweep.animate !== 'function') return;
  sweptBeat = c;
  sweep.animate([
    { WebkitMaskPosition: '100% 0', maskPosition: '100% 0', opacity: 0 },
    { opacity: 0.85, offset: 0.18 },
    { opacity: 0.85, offset: 0.78 },
    { WebkitMaskPosition: '0% 0', maskPosition: '0% 0', opacity: 0 },
  ], { duration: 900, easing: 'cubic-bezier(.3,.6,.3,1)' });
}

let settleAnimation = null;
function playSettleGlow() {
  if (!getSettings().settleGlow) return;
  const c = Math.round(visual);
  if (Math.abs(visual - c) > 0.12) return;
  const layer = layers.find(l => l._beat === c);
  const glow = layer?._glow;
  if (!glow || typeof glow.animate !== 'function') return;
  if (settleAnimation) settleAnimation.cancel();
  const base = Number(layer._glowOpacity) || 0;
  settleAnimation = glow.animate([{ opacity: base }, { opacity: 0.78, offset: 0.35 }, { opacity: base }], { duration: 900, easing: 'ease-in-out' });
  settleAnimation.onfinish = () => { settleAnimation = null; };
}

// Called whenever motion comes to rest (end of glide, fling, settle, drag release, auto-scroll end).
function motionRested() {
  refreshParkState();
  if (getSettings().scrollMode === 'snap' && !dragging && beats.length > 1) {
    const base = Math.floor(visual);
    const frac = visual - base;
    if (frac > 0.004 && frac < 0.996) {
      const threshold = clamp(Number(getSettings().threshold) || 0.32, 0.05, 0.95);
      // Past the threshold in the direction of travel: go on to the next line; otherwise fall back.
      const ahead = lastDirection >= 0 ? frac >= threshold : (1 - frac) < threshold;
      startSettle(ahead ? base + 1 : base);
      return;
    }
  }
  playSettleGlow();
  playLightSweep();
  scheduleBreath();
  playFinishRing();
}

// ---------- Fade back to chat after auto-scroll finishes ----------
let fadeOnEndTimer = null;
function cancelFadeOnEnd() { if (fadeOnEndTimer) { clearTimeout(fadeOnEndTimer); fadeOnEndTimer = null; } }
function scheduleFadeOnEnd() {
  cancelFadeOnEnd();
  if (!getSettings().fadeOnEnd) return;
  const message = activeMessageId;
  const count = beats.length;
  fadeOnEndTimer = setTimeout(() => {
    fadeOnEndTimer = null;
    const stillStreaming = performance.now() - lastStreamToken < 1500;
    if (!host?.classList.contains('open') || activeMessageId !== message || beats.length !== count || !atEndBoundary() || dragging || stillStreaming) return;
    closeImmersive();
  }, 1500);
}

function openMessage(messageId) {
  const message = chat[messageId];
  // Hidden messages get is_system=true in SillyTavern; still allow opening them on explicit request.
  if (!message) return;
  activeMessageId = Number(messageId);
  suppressedStreamingMessageId = null;
  createOverlay();
  beats = buildBeatsFromMessage(message, activeMessageId);
  if (!beats.length) { toastr?.info?.('Nothing to read in this message.', 'Immersive Mode'); return; }
  resetMotion();
  host.classList.remove('closing'); host.style.opacity = ''; host.style.transition = '';
  host.classList.add('open');
  document.body.classList.add('immersive-mode-active');
  applyOverlaySettings();
  measureBeats();
  paint();
  if (getSettings().autoScroll) startAutoScroll();
}

function openLatestAssistant() { for (let i = chat.length - 1; i >= 0; i--) { if (chat[i] && !chat[i].is_user && !chat[i].is_system) { openMessage(i); return; } } toastr?.warning?.('No assistant message found.', 'Immersive Mode'); }

let lastStreamToken = 0;
function updateStreamingMessage() {
  lastStreamToken = performance.now();
  const settings = getSettings();
  if (!settings.streamCapture) return;
  const messageId = chat.length - 1;
  if (suppressedStreamingMessageId !== null && Number(messageId) !== Number(suppressedStreamingMessageId)) suppressedStreamingMessageId = null;
  if (Number(messageId) === Number(suppressedStreamingMessageId)) return;
  const message = chat[messageId];
  if (!message || message.is_user || message.is_system) return;

  const overlayOpen = !!host?.classList.contains('open');
  const sameMessageOpen = overlayOpen && Number(activeMessageId) === Number(messageId);
  // Streaming capture should NOT auto-open by itself. It only opens during streaming when autoOpen is enabled.
  if (!sameMessageOpen && !settings.autoOpen) return;

  streamingPending = true;
  if (streamingUpdateTimer) return;
  const delay = isPerfActive() || isMobileViewport() ? 360 : 180;
  streamingUpdateTimer = setTimeout(() => {
    streamingUpdateTimer = null;
    if (!streamingPending) return;
    streamingPending = false;
    const now = performance.now();
    if (now - lastStreamingUpdate < delay * 0.65) return;
    lastStreamingUpdate = now;
    const latestMessage = chat[messageId];
    if (!latestMessage || latestMessage.is_user || latestMessage.is_system) return;
    const nextBeats = buildBeatsFromMessage(latestMessage, messageId);
    if (!nextBeats.length) return;
    createOverlay();
    activeMessageId = Number(messageId);
    beats = nextBeats;
    index = clamp(index, 0, Math.max(0, beats.length - 1));
    targetIndex = clamp(targetIndex, 0, Math.max(0, beats.length - 1));
    visual = clamp(visual, 0, Math.max(0, beats.length - 1));
    targetVisual = clamp(targetVisual, 0, Math.max(0, beats.length - 1));
    host.classList.remove('closing'); host.style.opacity = ''; host.style.transition = '';
    host.classList.add('open');
    document.body.classList.add('immersive-mode-active');
    applyOverlaySettings();
    measureBeats();
    paint();
  }, delay);
}

function finishCloseImmersive() { stopAutoScroll(); stopBreath(); host?.classList.remove('open', 'closing'); if (host) { host.style.opacity = ''; host.style.transition = ''; } document.body.classList.remove('immersive-mode-active', 'im-hide-st-chrome', 'im-backdrop-frosted'); }
function fadeCloseImmersive() { if (!host?.classList.contains('open') || host.classList.contains('closing')) return; host.classList.add('closing'); host.style.transition = 'opacity 420ms ease'; host.style.opacity = '0'; setTimeout(finishCloseImmersive, 430); }
function closeImmersive() { if (activeMessageId !== null) suppressedStreamingMessageId = Number(activeMessageId); fadeCloseImmersive(); }

function startSettle(toIndex) {
  // Barrier-based exit: if already parked at a boundary and pushing further, exit.
  const from0 = Math.round(visual);
  if (toIndex > from0 && attemptBoundaryExit(1)) return;
  if (toIndex < from0 && attemptBoundaryExit(-1)) return;
  const last = beats.length - 1;
  if (toIndex > last && atEndBoundary()) kickEdge(1, 0.7);
  if (toIndex < 0 && atStartBoundary()) kickEdge(-1, 0.7);
  toIndex = clamp(toIndex, 0, last);
  if (toIndex !== Math.round(visual)) lastDirection = toIndex > visual ? 1 : -1;
  targetIndex = toIndex;
  if (transitionRaf) cancelAnimationFrame(transitionRaf);
  if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = null; }
  if (glideRaf) { cancelAnimationFrame(glideRaf); glideRaf = null; glideVelocity = 0; }
  const from = visual;
  const to = toIndex;
  targetVisual = toIndex;
  const start = performance.now();
  const dur = getWeight().dur;
  function step(now) {
    const t = clamp((now - start) / dur, 0, 1);
    visual = from + (to - from) * easeOutCubic(t);
    paint();
    if (t < 1) transitionRaf = requestAnimationFrame(step);
    else { index = to; targetIndex = to; visual = to; offset = 0; transitionRaf = null; paint(); motionRested(); }
  }
  transitionRaf = requestAnimationFrame(step);
}

function getWeight() { return WEIGHTS[getSettings().weight] || WEIGHTS.heavy; }

function updateFromVisualPosition() {
  index = Math.floor(clamp(visual, 0, Math.max(0, beats.length - 1)));
  targetIndex = Math.round(clamp(visual, 0, beats.length - 1));
  offset = visual - index;
  // Moving away from a boundary clears its parked flag (so re-arriving requires a fresh push to exit).
  if (!atEndBoundary()) parkedEnd = false;
  if (!atStartBoundary()) parkedStart = false;
}

function smoothDragTo(nextTarget) {
  targetVisual = clamp(nextTarget, 0, beats.length - 1);
  if (dragRaf) return;
  const step = () => {
    const diff = targetVisual - visual;
    if (Math.abs(diff) < 0.001) {
      visual = targetVisual;
      updateFromVisualPosition();
      paint();
      dragRaf = null;
      motionRested();
      return;
    }
    visual += diff * 0.22;
    updateFromVisualPosition();
    paint();
    dragRaf = requestAnimationFrame(step);
  };
  dragRaf = requestAnimationFrame(step);
}

function atEndBoundary() { return visual >= (beats.length - 1) - 0.001; }
function atStartBoundary() { return visual <= 0.001; }

function refreshParkState() {
  // Parked = motion is resting against a boundary. Set only when essentially stopped there.
  // The edge bounce is drawn separately (overscroll), so it never delays parking: a quick
  // second push after reaching an edge still exits.
  parkedEnd = atEndBoundary();
  parkedStart = atStartBoundary();
}

// Barrier-based exit: if already parked at a boundary and the user pushes that way again, exit.
function attemptBoundaryExit(dir) {
  const settings = getSettings();
  if (dir > 0 && atEndBoundary() && parkedEnd && settings.exitAtEnd) { fadeCloseImmersive(); return true; }
  if (dir < 0 && atStartBoundary() && parkedStart && settings.exitAtStart) { fadeCloseImmersive(); return true; }
  return false;
}

// One momentum loop for wheel glide and drag fling; only the friction differs.
function runMomentum(friction) {
  if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = null; }
  lastGlideTs = performance.now();
  if (glideRaf) return;
  const step = now => {
    const dt = Math.min(2.2, Math.max(0.5, (now - lastGlideTs) / 16.67));
    lastGlideTs = now;
    const last = beats.length - 1;
    const next = visual + glideVelocity * dt;
    if (glideVelocity) lastDirection = glideVelocity > 0 ? 1 : -1;
    visual = clamp(next, 0, last);
    if (next <= 0 || next >= last) {
      // Hitting an edge hands the leftover speed to the bounce instead of stopping dead.
      if (Math.abs(glideVelocity) > 0.004 && (next < 0 || next > last)) kickEdge(next > last ? 1 : -1, Math.abs(glideVelocity) / 0.12);
      glideVelocity = 0;
    }
    glideVelocity *= Math.pow(friction, dt);
    targetVisual = visual;
    updateFromVisualPosition();
    paint();
    if (Math.abs(glideVelocity) < 0.0009) {
      glideVelocity = 0;
      glideRaf = null;
      motionRested();
      return;
    }
    glideRaf = requestAnimationFrame(step);
  };
  glideRaf = requestAnimationFrame(step);
}

function startGlide(delta) {
  glideVelocity += delta * 0.18;
  runMomentum(0.925);
}

function flingWith(velocity) {
  glideVelocity = velocity;
  runMomentum(0.94);
}

// The focal card or oversized beat scrolls inside itself before the reader moves on, so tall
// HTML/regex cards and code are read without leaving the reader.
function focalScroller() {
  const c = Math.round(visual);
  if (Math.abs(visual - c) > 0.2) return null;
  const layer = layers.find(l => l._beat === c);
  if (!layer || layer.scrollHeight <= layer.clientHeight + 1) return null;
  return layer;
}

function scrollInside(layer, dy) {
  if (!layer || !dy) return 0;
  const before = layer.scrollTop;
  layer.scrollTop = clamp(before + dy, 0, layer.scrollHeight - layer.clientHeight);
  return layer.scrollTop - before;
}

function inputStarted() {
  stopBreath();
  if (transitionRaf) {
    cancelAnimationFrame(transitionRaf);
    transitionRaf = null;
  }
  pauseAutoScroll(520);
  updateFromVisualPosition();
}

function getDragSensitivity() {
  return clamp(Number(getSettings().dragSensitivity) || DEFAULT_SETTINGS.dragSensitivity, 0.65, 1.25);
}

function pauseAutoScroll(ms = 420) {
  if (!autoScrollRaf || !getSettings().autoScroll) return;
  autoScrollPaused = true;
  autoScrollResumeAt = Math.max(autoScrollResumeAt, performance.now() + ms);
  // Do not zero current speed instantly — it decays in startAutoScroll() so resuming feels continuous.
}

function resumeAutoScrollSoon(ms = 180) {
  if (!autoScrollRaf || !getSettings().autoScroll) return;
  autoScrollPaused = true;
  autoScrollResumeAt = Math.max(autoScrollResumeAt, performance.now() + ms);
}

function startAutoScroll() {
  if (autoScrollRaf) return;
  autoScrollLastTs = performance.now();
  autoScrollPaused = false;
  autoScrollResumeAt = 0;
  autoScrollCurrentSpeed = 0;
  if (autoBtn) autoBtn.classList.add('active');
  const step = now => {
    const dt = Math.min(3, Math.max(0.5, (now - autoScrollLastTs) / 16.67));
    autoScrollLastTs = now;
    const desired = Number(getSettings().autoScrollSpeed) || DEFAULT_SETTINGS.autoScrollSpeed;
    const paused = dragging || transitionRaf || glideRaf || (autoScrollPaused && now < autoScrollResumeAt);
    const targetSpeed = paused ? 0 : desired;
    // Smooth speed recovery/decay: manual input halts auto; on release it eases back to speed.
    autoScrollCurrentSpeed += (targetSpeed - autoScrollCurrentSpeed) * (paused ? 0.20 : 0.055) * dt;
    if (autoScrollPaused && now >= autoScrollResumeAt && !dragging && !transitionRaf && !glideRaf) autoScrollPaused = false;
    if (Math.abs(autoScrollCurrentSpeed) > 0.0005) {
      visual = clamp(visual + (autoScrollCurrentSpeed / 60) * dt, 0, beats.length - 1);
      targetVisual = visual;
      updateFromVisualPosition();
      paint();
    }
    if (visual >= beats.length - 1) { stopAutoScroll(); motionRested(); scheduleFadeOnEnd(); return; }
    autoScrollRaf = requestAnimationFrame(step);
  };
  autoScrollRaf = requestAnimationFrame(step);
}

function stopAutoScroll() {
  if (autoScrollRaf) { cancelAnimationFrame(autoScrollRaf); autoScrollRaf = null; }
  autoScrollPaused = false;
  autoScrollResumeAt = 0;
  autoScrollCurrentSpeed = 0;
  if (autoBtn) autoBtn.classList.remove('active');
}

function setAutoScroll(on) {
  getSettings().autoScroll = !!on;
  saveSettings();
  if (on) startAutoScroll(); else stopAutoScroll();
}

function attachAutoScrollControl() {
  if (!autoBtn) return;
  let pressTimer = null;
  let pressing = false;   // pointer button is physically down on the control
  let holding = false;    // hold-to-adjust gesture engaged
  let anchorX = 0;
  let gestureStartFrac = 0;
  let moved = false;
  let capturedId = null;
  // Full comfortable drag (~300px) sweeps the whole normalized range.
  const PX_PER_RANGE = 300;

  const beginHold = () => {
    holding = true;
    // Anchor to current speed (as a fraction) so re-dragging continues smoothly, no reset.
    gestureStartFrac = asSpeedToFrac(Number(getSettings().autoScrollSpeed) || DEFAULT_SETTINGS.autoScrollSpeed);
    if (speedHint) speedHint.classList.add('show');
    updateSpeedHint();
  };

  const releaseCapture = () => {
    if (capturedId !== null) { try { autoBtn.releasePointerCapture(capturedId); } catch (e) { /* ignore */ } capturedId = null; }
  };

  autoBtn.addEventListener('pointerdown', event => {
    event.preventDefault();
    pressing = true;
    anchorX = event.clientX;
    moved = false;
    holding = false;
    capturedId = event.pointerId;
    try { autoBtn.setPointerCapture(event.pointerId); } catch (e) { capturedId = null; }
    pressTimer = setTimeout(beginHold, 200);
  });
  autoBtn.addEventListener('pointermove', event => {
    if (!pressing) return; // ignore plain hover — only adjust while the button is actually held down
    if (!holding) {
      if (Math.abs(event.clientX - anchorX) > 6) { clearTimeout(pressTimer); beginHold(); }
      else return;
    }
    moved = true;
    const frac = gestureStartFrac + (event.clientX - anchorX) / PX_PER_RANGE;
    getSettings().autoScrollSpeed = asFracToSpeed(frac);
    updateSpeedHint();
  });
  const endGesture = () => {
    clearTimeout(pressTimer);
    releaseCapture();
    if (speedHint) speedHint.classList.remove('show');
    const wasHoldAdjust = holding && moved;
    pressing = false;
    holding = false;
    moved = false;
    if (wasHoldAdjust) {
      saveSettings();
      if (!autoScrollRaf) setAutoScroll(true); // keep scrolling at the chosen speed
      return;
    }
    // Simple tap = toggle on/off
    setAutoScroll(!autoScrollRaf);
  };
  autoBtn.addEventListener('pointerup', endGesture);
  autoBtn.addEventListener('pointercancel', () => { clearTimeout(pressTimer); releaseCapture(); pressing = false; holding = false; moved = false; if (speedHint) speedHint.classList.remove('show'); });
}

function updateSpeedHint() {
  if (!speedHint) return;
  const s = Number(getSettings().autoScrollSpeed) || DEFAULT_SETTINGS.autoScrollSpeed;
  speedHint.textContent = `Auto-scroll speed: ${s.toFixed(2)}`;
}

function attachMotionHandlers() {
  stage.addEventListener('wheel', event => {
    event.preventDefault();
    cancelFadeOnEnd();
    const settings = getSettings();
    const direction = event.deltaY > 0 ? 1 : -1;
    const dy = event.deltaMode === 1 ? event.deltaY * 32 : event.deltaY;
    // A tall card under focus scrolls inside itself first; the reader moves on once it reaches its end.
    if (scrollInside(focalScroller(), dy)) { pauseAutoScroll(520); return; }
    if (settings.scrollMode === 'step') {
      const base = transitionRaf ? targetIndex : Math.round(visual);
      inputStarted();
      startSettle(base + direction);
      return;
    }
    inputStarted();
    // Free wheel scrolling never exits (unchanged); resting against an edge just bounces.
    if (!glideRaf && ((direction > 0 && atEndBoundary()) || (direction < 0 && atStartBoundary()))) {
      kickEdge(direction, Math.abs(dy) / 100);
      refreshParkState();
      return;
    }
    const delta = dy * getWeight().wheel * getDragSensitivity();
    if (settings.scrollFeel === 'glide') startGlide(delta);
    else smoothDragTo(targetVisual + delta);
  }, { passive: false });
  let dragScroller = null;
  let dragLastY = 0;
  stage.addEventListener('pointerdown', event => {
    dragging = true;
    cancelFadeOnEnd();
    inputStarted();
    if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = null; }
    if (glideRaf) { cancelAnimationFrame(glideRaf); glideRaf = null; glideVelocity = 0; }
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    dragStartVisual = visual;
    dragStartParkedEnd = parkedEnd;
    dragStartParkedStart = parkedStart;
    dragScroller = focalScroller();
    dragLastY = event.clientY;
    pointerVel = 0;
    lastMoveY = event.clientY;
    lastMoveTs = performance.now();
    overscrollHeld = true;
    overscrollVel = 0;
    stage.classList.add('drag');
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener('pointermove', event => {
    if (!dragging) return;
    // Dragging a tall card scrolls the card first, then carries on to the next beat.
    if (dragScroller) {
      const used = scrollInside(dragScroller, dragLastY - event.clientY);
      dragLastY = event.clientY;
      if (used) { dragStartY = event.clientY; dragStartVisual = visual; return; }
    }
    dragLastY = event.clientY;
    const stepSize = Number(getSettings().spread) || DEFAULT_SETTINGS.spread;
    const sensitivity = getDragSensitivity();
    const raw = dragStartVisual - ((event.clientY - dragStartY) / stepSize) * sensitivity;
    const last = beats.length - 1;
    visual = clamp(raw, 0, last);
    // Past an edge the stack stretches with resistance (released into the bounce on pointerup).
    if (getSettings().edgeBounce) overscroll = raw < 0 ? -Math.min(0.55, -raw * 0.3) : raw > last ? Math.min(0.55, (raw - last) * 0.3) : 0;
    if (overscroll) overscrollEdge = Math.sign(overscroll);
    if (raw !== visual) lastDirection = raw > visual ? 1 : -1;
    targetVisual = visual;
    updateFromVisualPosition();
    paint();
    const now = performance.now();
    const dtMs = now - lastMoveTs;
    if (dtMs > 0) {
      // beats moved per frame from the pixel delta since last move
      const beatsPerPx = sensitivity / stepSize;
      const instVel = -((event.clientY - lastMoveY) * beatsPerPx) * (16.67 / dtMs);
      pointerVel = pointerVel * 0.5 + instVel * 0.5;
      lastMoveY = event.clientY;
      lastMoveTs = now;
    }
  });
  const releaseDrag = event => {
    if (!dragging) return;
    dragging = false;
    overscrollHeld = false;
    startFxLoop();
    stage.classList.remove('drag');
    const settings = getSettings();
    const dx = event.clientX - dragStartX;
    const dy = event.clientY - dragStartY;
    // Horizontal swipe = discrete prev/next (mobile)
    if (settings.mobileSwipeNavigation && Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.25) {
      offset = 0;
      startSettle(targetIndex + (dx < 0 ? 1 : -1));
      resumeAutoScrollSoon(260);
      return;
    }
    // Barrier-based exit: if this drag started while parked at a boundary and pushed further toward it, exit.
    if (dragStartParkedEnd && dy < -6 && atEndBoundary() && settings.exitAtEnd) { fadeCloseImmersive(); return; }
    if (dragStartParkedStart && dy > 6 && atStartBoundary() && settings.exitAtStart) { fadeCloseImmersive(); return; }
    // Vertical release from direct dragging is always free-drag behavior.
    if (Math.abs(pointerVel) > 0.012) {
      flingWith(clamp(pointerVel, -0.9, 0.9));
      resumeAutoScrollSoon(320);
      return;
    }
    motionRested();
    resumeAutoScrollSoon(220);
  };
  stage.addEventListener('pointerup', releaseDrag);
  stage.addEventListener('pointercancel', releaseDrag);
  document.addEventListener('keydown', event => {
    if (!host?.classList.contains('open')) return;
    const next = ['ArrowDown', 'ArrowRight', 'Space', 'PageDown'].includes(event.code);
    const prev = ['ArrowUp', 'ArrowLeft', 'PageUp'].includes(event.code);
    if (next || prev) {
      event.preventDefault();
      event.stopPropagation();
      cancelFadeOnEnd();
      const scroller = focalScroller();
      const page = scroller ? scroller.clientHeight * 0.8 : 0;
      if (scroller && scrollInside(scroller, next ? page : -page)) return;
      // A press during a running move continues from where that move is going, so quick
      // presses are never lost.
      const base = transitionRaf ? targetIndex : Math.round(visual);
      inputStarted();
      startSettle(base + (next ? 1 : -1));
      resumeAutoScrollSoon(260);
    }
    if (event.code === 'Escape') { event.preventDefault(); event.stopPropagation(); closeImmersive(); }
  }, true);
  let resizeTimer = null;
  window.addEventListener('resize', () => { if (!host?.classList.contains('open')) return; clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { applyOverlaySettings(); remeasureAndPaint(); }, 90); });
}

function addMessageButton() { if ($('#message_template .mes_immersive_mode_button').length) return; const button = $('<div title="Open immersive reader" class="mes_button mes_immersive_mode_button fa-solid fa-book-open interactable" tabindex="0"></div>'); $('#message_template .mes_buttons .extraMesButtons').prepend(button); updateMessageButtonVisibility(); }
function addSendButton() { if ($('#rightSendForm .im_send_immersive_button').length) return; const button = $('<div title="Open immersive reader" class="fa-solid fa-book-open interactable im_send_immersive_button" tabindex="0"></div>'); $('#rightSendForm').prepend(button); updateSendButtonVisibility(); }
function updateSendButtonVisibility() { document.body.classList.toggle('im-send-button-hidden', !getSettings().showSendButton); }
function updateMessageButtonVisibility() { $('.mes_immersive_mode_button').toggle(!!getSettings().showButton); }
function attachDelegatedHandlers() { $(document).off('click.immersiveModeButton').on('click.immersiveModeButton', '.mes_immersive_mode_button', function () { openMessage(Number($(this).closest('.mes').attr('mesid'))); }); $(document).off('click.immersiveModeSendButton').on('click.immersiveModeSendButton', '.im_send_immersive_button', openLatestAssistant); }

// Each drawer control maps to one setting. `after` names what has to refresh once it changes.
const SETTING_CONTROLS = [
  // Reading
  { cls: 'im_display_mode', key: 'displayMode', type: 'select', after: 'paint' },
  { cls: 'im_position', key: 'position', type: 'select', after: 'layout' },
  { cls: 'im_font_size', key: 'fontSize', type: 'number', after: 'layout', label: v => String(v) },
  { cls: 'im_spread', key: 'spread', type: 'number', after: 'layout', label: v => String(v) },
  { cls: 'im_context_preview', key: 'contextPreview', type: 'check', after: 'paint' },
  { cls: 'im_preview_ahead', key: 'previewAhead', type: 'number', after: 'paint', label: v => String(v) },
  { cls: 'im_preview_behind', key: 'previewBehind', type: 'number', after: 'paint', label: v => String(v) },
  { cls: 'im_shrink_oversized', key: 'shrinkOversizedBeats', type: 'check', after: 'layout' },
  // Look & feel
  { cls: 'im_material', key: 'material', type: 'select', after: 'overlay' },
  { cls: 'im_rail_style', key: 'railStyle', type: 'select', after: 'overlay' },
  { cls: 'im_keep_colors', key: 'keepMessageColors', type: 'check', after: 'content' },
  { cls: 'im_focus_bloom', key: 'focusBloom', type: 'check', after: 'paint' },
  { cls: 'im_settle_glow', key: 'settleGlow', type: 'check' },
  { cls: 'im_glass_buttons', key: 'glassButtons', type: 'check', after: 'overlay' },
  { cls: 'im_backdrop', key: 'backdrop', type: 'select', after: 'overlay' },
  { cls: 'im_edge_style', key: 'edgeStyle', type: 'select', after: 'overlay' },
  { cls: 'im_edge_trace', key: 'edgeTrace', type: 'check', after: 'ambient' },
  { cls: 'im_dawn_glow', key: 'dawnGlow', type: 'check', after: 'ambient' },
  { cls: 'im_light_sweep', key: 'lightSweep', type: 'check' },
  { cls: 'im_ink_settle', key: 'inkSettle', type: 'check' },
  { cls: 'im_trailing_lines', key: 'trailingLines', type: 'check', after: 'paint' },
  { cls: 'im_dialogue_warmth', key: 'dialogueWarmth', type: 'check', after: 'mood' },
  { cls: 'im_focus_vignette', key: 'focusVignette', type: 'check', after: 'ambient' },
  { cls: 'im_depth_sway', key: 'depthSway', type: 'check', after: 'ambient' },
  { cls: 'im_breathing', key: 'breathing', type: 'check', after: 'breath' },
  { cls: 'im_finish_ring', key: 'finishRing', type: 'check' },
  { cls: 'im_show_progress', key: 'showProgress', type: 'check', after: 'layout' },
  { cls: 'im_show_inmode_controls', key: 'showInModeControls', type: 'check', after: 'layout' },
  { cls: 'im_show_message_ids', key: 'showMessageIds', type: 'check', after: 'layout' },
  // Motion
  { cls: 'im_scroll_mode', key: 'scrollMode', type: 'select' },
  { cls: 'im_threshold', key: 'threshold', type: 'number', label: v => Number(v).toFixed(2) },
  { cls: 'im_scroll_feel', key: 'scrollFeel', type: 'select' },
  { cls: 'im_weight', key: 'weight', type: 'select' },
  { cls: 'im_drag_sensitivity', key: 'dragSensitivity', type: 'number', label: v => Number(v).toFixed(2), clamp: [0.65, 1.25] },
  { cls: 'im_edge_bounce', key: 'edgeBounce', type: 'check' },
  { cls: 'im_fade_on_end', key: 'fadeOnEnd', type: 'check' },
  // Opening & closing
  { cls: 'im_auto_open', key: 'autoOpen', type: 'check' },
  { cls: 'im_stream_capture', key: 'streamCapture', type: 'check' },
  { cls: 'im_exit_at_end', key: 'exitAtEnd', type: 'check' },
  { cls: 'im_exit_at_start', key: 'exitAtStart', type: 'check' },
  { cls: 'im_hide_st_chrome', key: 'hideStChrome', type: 'check', after: 'layout' },
  { cls: 'im_mobile_swipe', key: 'mobileSwipeNavigation', type: 'check' },
  { cls: 'im_show_button', key: 'showButton', type: 'check', after: 'buttons' },
  { cls: 'im_show_send_button', key: 'showSendButton', type: 'check', after: 'buttons' },
  // Text splitting & cards
  { cls: 'im_content_mode', key: 'contentMode', type: 'select', after: 'content' },
  { cls: 'im_extraction_mode', key: 'extractionMode', type: 'select', after: 'content' },
  { cls: 'im_special_html', key: 'specialHtml', type: 'check', after: 'content' },
  { cls: 'im_special_code', key: 'specialCode', type: 'check', after: 'content' },
  { cls: 'im_skip_details_blocks', key: 'skipDetailsBlocks', type: 'check', after: 'content' },
  { cls: 'im_use_rendered_html', key: 'useRenderedHtml', type: 'check', after: 'content' },
  { cls: 'im_split_big_blocks', key: 'splitBigBlocks', type: 'check', after: 'content' },
  { cls: 'im_italic_atomic', key: 'italicAtomic', type: 'check', after: 'content' },
  { cls: 'im_include_asterisk_separators', key: 'includeAsteriskSeparators', type: 'check', after: 'content' },
  { cls: 'im_exclude_bracket_pipes', key: 'excludeBracketPipes', type: 'check', after: 'content' },
  { cls: 'im_prevent_code_html', key: 'preventCodeHtmlCapture', type: 'check', after: 'content' },
  // Performance
  { cls: 'im_mobile_performance', key: 'mobilePerformance', type: 'select', after: 'layout' },
];

// Rebuilds the open message's beats after a content setting changes, keeping the reading position.
function reloadOpenMessage() {
  if (!host?.classList.contains('open') || activeMessageId === null || !chat[activeMessageId]) return;
  const next = buildBeatsFromMessage(chat[activeMessageId], activeMessageId);
  if (!next.length) return;
  const frac = beats.length > 1 ? visual / (beats.length - 1) : 0;
  beats = next;
  visual = targetVisual = Math.round(frac * Math.max(0, beats.length - 1));
  updateFromVisualPosition();
  rail.count = -1;
  measureBeats();
  paint();
}

function refreshAfterSetting(after) {
  if (after === 'paint') { invalidateLayers(); paint(); }
  else if (after === 'overlay') { applyOverlaySettings(); paint(); }
  else if (after === 'layout') { applyOverlaySettings(); remeasureAndPaint(); }
  else if (after === 'content') reloadOpenMessage();
  else if (after === 'mood') paint();
  else if (after === 'breath') { if (getSettings().breathing) scheduleBreath(); else stopBreath(); }
  else if (after === 'ambient') { applyOverlaySettings(); ambient.drawn = ''; startFxLoop(); paint(); }
  else if (after === 'buttons') { updateMessageButtonVisibility(); updateSendButtonVisibility(); }
}

async function addSettingsUi() {
  const html = await renderExtensionTemplateAsync(extensionName, 'settings');
  $('#extensions_settings').append(html);
  const container = $('.immersive_mode_settings');
  const settings = getSettings();
  const updateVisibility = () => {
    container.find('.im_threshold_row').toggle(getSettings().scrollMode === 'snap');
  };
  for (const control of SETTING_CONTROLS) {
    const input = container.find(`.${control.cls}`);
    const label = container.find(`.${control.cls}_value`);
    const showLabel = () => { if (control.label) label.text(control.label(getSettings()[control.key])); };
    if (control.type === 'check') input.prop('checked', !!settings[control.key]);
    else input.val(settings[control.key]);
    showLabel();
    input.on(control.type === 'number' ? 'input change' : 'change', function () {
      let value;
      if (control.type === 'check') value = !!$(this).prop('checked');
      else if (control.type === 'number') {
        value = Number($(this).val());
        if (!Number.isFinite(value)) value = DEFAULT_SETTINGS[control.key];
        if (control.clamp) value = clamp(value, control.clamp[0], control.clamp[1]);
      } else value = String($(this).val() || DEFAULT_SETTINGS[control.key]);
      getSettings()[control.key] = value;
      saveSettings();
      showLabel();
      updateVisibility();
      if (control.key === 'mobilePerformance') updatePerfStatus();
      refreshAfterSetting(control.after);
    });
  }
  // Auto-scroll speed is stored as a speed but the slider moves on a curve, slow end first.
  const speed = container.find('.im_auto_scroll_speed');
  const speedLabel = () => container.find('.im_auto_scroll_speed_value').text((Number(getSettings().autoScrollSpeed) || DEFAULT_SETTINGS.autoScrollSpeed).toFixed(2));
  speed.val(asSpeedToFrac(Number(settings.autoScrollSpeed) || DEFAULT_SETTINGS.autoScrollSpeed)).on('input change', function () { getSettings().autoScrollSpeed = asFracToSpeed(Number($(this).val()) || 0); saveSettings(); speedLabel(); });
  speedLabel();
  container.find('.im_auto_scroll').prop('checked', !!settings.autoScroll).on('change', function () { const current = getSettings(); current.autoScroll = !!$(this).prop('checked'); saveSettings(); if (host?.classList.contains('open')) setAutoScroll(current.autoScroll); });
  // ---- Effects preset and cost labels ----
  const tierLabel = percent => (percent <= 0 ? 'free' : `+${percent}%`);
  for (const control of SETTING_CONTROLS) {
    const input = container.find(`.${control.cls}`);
    if (control.type === 'check' && EFFECT_COSTS[control.key] !== undefined) {
      const cost = EFFECT_COSTS[control.key];
      const note = control.key === 'finishRing' ? 'free with Edge trace' : tierLabel(cost);
      input.closest('label').append(`<span class="im-cost-tag im-cost-${costTier(cost)}" title="Measured cost while scrolling">${note}</span>`);
    } else if (control.type === 'select') {
      input.find('option').each(function () {
        const cost = EFFECT_COSTS[`${control.key}:${this.value}`];
        if (cost !== undefined) this.textContent = `${this.textContent} · ${tierLabel(cost)}`;
      });
    }
  }
  const syncInputs = () => {
    const current = getSettings();
    for (const control of SETTING_CONTROLS) {
      const input = container.find(`.${control.cls}`);
      if (control.type === 'check') input.prop('checked', !!current[control.key]);
      else input.val(current[control.key]);
      if (control.label) container.find(`.${control.cls}_value`).text(control.label(current[control.key]));
    }
  };
  const updateCost = () => {
    const current = getSettings();
    const estimate = estimateCost(current);
    const presetName = estimate.measured ? estimate.preset : 'custom';
    container.find('.im_preset').val(presetName);
    container.find('.im_preset_note').text(presetName === 'custom' ? 'Your own mix.' : PRESETS[presetName].note);
    const perf = isPerfActive();
    const label = estimate.percent <= 0 ? 'about free' : `${estimate.measured ? '' : '~'}+${estimate.percent}% frame time`;
    container.find('.im_cost_text').text(perf ? `${label} (performance mode is on, so less)` : label);
    container.find('.im-cost-fill').css('width', `${Math.min(100, (estimate.percent / 130) * 100)}%`);
  };
  container.find('.im_preset').on('change', function () {
    const name = String($(this).val());
    if (!PRESETS[name]) { updateCost(); return; }
    Object.assign(getSettings(), PRESETS[name].values);
    saveSettings();
    syncInputs();
    updateVisibility();
    refreshAfterSetting('overlay');
    refreshAfterSetting('ambient');
    if (!getSettings().breathing) stopBreath();
    updateCost();
  });
  container.on('change input', 'input, select', function () { if (!$(this).hasClass('im_preset')) updateCost(); });
  updateCost();

  const updatePerfStatus = () => container.find('.im_perf_status').text('Currently: ' + (isPerfActive() ? 'on' : 'off') + (isMobileViewport() ? ' (phone or tablet detected)' : ' (desktop)'));
  updatePerfStatus();
  updateVisibility();
  container.find('.im_open_now').on('click', openLatestAssistant);
  container.find('.im_close_now').on('click', closeImmersive);
}

function registerEvents() { eventSource.makeLast(event_types.CHARACTER_MESSAGE_RENDERED, (messageId, type) => { const message = chat[messageId]; if (!message || message.is_user || message.is_system) return; if (getSettings().autoOpen && ['normal', 'continue', 'swipe'].includes(type || 'normal')) openMessage(Number(messageId)); }); eventSource.on(event_types.STREAM_TOKEN_RECEIVED, updateStreamingMessage); eventSource.on(event_types.CHAT_CHANGED, closeImmersive); }
function registerSlashCommand() { SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'immersive', callback: () => { openLatestAssistant(); return ''; }, helpString: 'Open Immersive Mode for the latest assistant message.' })); }
function exposePublicApi() { globalThis.SillyTavernImmersiveMode = { openLatest: openLatestAssistant, openMessage, close: closeImmersive, debugOpenHtml(html, name = 'Seraphine') { createOverlay(); activeMessageId = -1; beats = buildBeatsFromMessage({ mes: String(html || ''), name, is_user: false, is_system: false }, 'debug'); resetMotion(); host.classList.remove('closing'); host.style.opacity = ''; host.style.transition = ''; host.classList.add('open'); document.body.classList.add('immersive-mode-active'); applyOverlaySettings(); measureBeats(); paint(); }, getState() { return { activeMessageId, beats: beats.map(b => stripTags(b.html)), beatHtml: beats.map(b => b.html), index, targetIndex, visual, targetVisual, autoScroll: !!autoScrollRaf, autoScrollPaused, autoScrollCurrentSpeed, autoScrollResumeAt, dragSensitivity: getDragSensitivity(), open: host?.classList.contains('open') || false, renderedLayers: layers.length, overscroll, overscrollVel, overscrollHeld, fxRunning: !!fxRaf, fxSpeed, lagPos: lag.pos, moving: !!(transitionRaf || glideRaf || dragRaf), parkedEnd, parkedStart }; }, debugSegmentHtml(html) { return buildBeatsFromMessage({ mes: String(html || ''), name: 'debug', is_user: false, is_system: false }, 'debug').map(b => stripTags(b.html)); }, debugNormalizeHtml(html) { currentPreserved = []; const normalized = normalizeMessageText(String(html || ''), (getSettings().contentMode || 'rp') === 'general'); return { normalized, tokens: tokenizeIntoBeats(normalized), currentPreserved }; }, debugSetSettings(next) { Object.assign(getSettings(), next || {}); saveSettings(); if (host) { applyOverlaySettings(); paint(); } }, debugSetAuto(on) { setAutoScroll(!!on); }, debugUpdateStreaming() { updateStreamingMessage(); } }; }

async function init() { if (initialized) return; initialized = true; getSettings(); await addSettingsUi(); createOverlay(); addMessageButton(); addSendButton(); attachDelegatedHandlers(); registerEvents(); registerSlashCommand(); exposePublicApi(); console.log('[Immersive Mode] Loaded layered reader engine.'); }
init().catch(error => { console.error('[Immersive Mode] Init failed:', error); toastr?.error?.(`Init failed: ${error?.message || error}`, 'Immersive Mode'); });
