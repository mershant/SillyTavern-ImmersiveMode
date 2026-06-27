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
  scrollBehavior: 'drag',
  scrollFeel: 'glide',
  extractionMode: 'sentence',
  contentMode: 'rp',
  specialCode: false,
  specialHtml: false,
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
let fontRange;
let chromeButton;
let activeMessageId = null;
let beats = [];
let index = 0;
let visual = 0;
let targetVisual = 0;
let dragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragStartOffset = 0;
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
  return settings;
}

function saveSettings() { saveSettingsDebounced(); }
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function stripTags(html) { const div = document.createElement('div'); div.innerHTML = String(html || ''); return div.textContent || ''; }
function escapeHtml(value) { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }

// Inline styling tags we keep live (so <font color>, colored spans, mark/u/s render as-is in prose).
const INLINE_KEEP_TAGS = new Set(['FONT', 'MARK', 'U', 'S', 'SMALL', 'SUB', 'SUP', 'SPAN']);
let currentPreserved = [];
let htmlBlockStore = [];
function inlineOpenClose(el) {
  const clone = el.cloneNode(false);
  const tag = clone.outerHTML.replace(/><\/[^>]+>$/, '>');
  return { open: tag, close: `</${el.tagName.toLowerCase()}>` };
}
function sanitizeInlineEl(el) {
  // Keep only safe presentational attributes.
  const allowed = ['color', 'style', 'class'];
  for (const attr of [...el.attributes]) {
    if (!allowed.includes(attr.name.toLowerCase())) el.removeAttribute(attr.name);
  }
  // Strip any event handlers / url() in style just in case.
  const style = el.getAttribute('style');
  if (style && /url\s*\(|expression\s*\(|javascript:/i.test(style)) el.removeAttribute('style');
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
  if (!generalMode) {
    div.querySelectorAll('strong, b').forEach(el => el.replaceWith(document.createTextNode(`==${el.textContent || ''}==`)));
    div.querySelectorAll('em, i').forEach(el => el.replaceWith(document.createTextNode(`*${el.textContent || ''}*`)));
  }
  // Preserve inline styling tags as HTML tokens so colors survive the plain-text pipeline.
  if (settings.specialHtml) {
    div.querySelectorAll('font, mark, u, s, small, sub, sup, span[style], span[class]').forEach(el => {
      if (!INLINE_KEEP_TAGS.has(el.tagName)) return;
      sanitizeInlineEl(el);
      const idx = currentPreserved.length;
      currentPreserved.push(inlineOpenClose(el));
      el.replaceWith(document.createTextNode(`@@IM_OPEN_${idx}@@${el.textContent || ''}@@IM_CLOSE_${idx}@@`));
    });
  }
  let text = (div.textContent || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
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
  // Inline HTML markers survive segmentation and are restored in renderBeatHtml.
  return text;
}

function renderBeatHtml(text) {
  let safe = escapeHtml(text);
  // Bold/highlight pops
  safe = safe.replace(/==([^=]+)==/g, '<span class="im-pop">$1</span>');
  safe = safe.replace(/\*\*([^*]+)\*\*/g, '<span class="im-pop">$1</span>');
  // Whole-beat italic wrap (RP asterisk action line)
  safe = safe.replace(/^\*([^]+)\*$/g, '<em>$1</em>');
  // Inline italics for any remaining *paired* asterisks (handles general mode markdown emphasis)
  safe = safe.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
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

function tokenizeIntoBeats(text) {
  const out = [];
  const src = String(text || '');
  // Match atomic quoted dialogue / emphasized text. Inline HTML markers are attached below.
  const atomRe = /("[^"\n]*(?:\n[^"\n]*)?"|“[^”]*”|\*[^*]+\*)/g;
  let last = 0;
  let match;
  while ((match = atomRe.exec(src))) {
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
    // Top-level block <div> that contains markup (e.g. a styled card not wrapped in <details>).
    [...div.children].forEach(el => {
      if (el.tagName === 'DIV' && /<(div|span|font|table|p|br|b|i|em|strong)/i.test(el.innerHTML)) {
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
    if (el && el.innerHTML && el.innerHTML.trim()) return el.innerHTML;
  }
  return message?.mes || '';
}

function buildBeatsFromMessage(message, messageId) {
  const settings = getSettings();
  currentPreserved = [];
  htmlBlockStore = [];
  const sourceHtml = getMessageSourceHtml(message, messageId);
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
        const tokens = settings.splitBigBlocks ? (generalMode ? tokenizePlain(cleaned) : tokenizeIntoBeats(cleaned)) : [cleaned];
        for (const t of tokens) if (String(t).trim()) rawBeats.push({ block: '', text: t });
      }
    }
  } else {
    const text = normalizeMessageText(sourceHtml, generalMode);
    const raw = settings.splitBigBlocks ? (generalMode ? tokenizePlain(text) : tokenizeIntoBeats(text)) : [text];
    rawBeats = raw.filter(x => String(x).trim()).map(t => ({ block: '', text: t }));
  }
  return rawBeats
    .filter(b => b.block === 'html' ? true : String(b.text).trim())
    .map((b, i) => {
      if (b.block === 'html') return { html: renderHtmlBeat(b.html), who: '', id: i === 0 ? `#${messageId}` : '', isCode: true, isHtml: true };
      if (b.block === 'code') return { html: renderCodeBeatHtml(b.text, b.lang, b.block), who: '', id: i === 0 ? `#${messageId}` : '', isCode: true };
      return { html: renderBeatHtml(b.text), who: i === 0 ? getMessageName(message) : '', id: i === 0 ? `#${messageId}` : '', isCode: false };
    });
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
  return wrap.innerHTML;
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
    .close,.pill{border:1px solid rgba(255,255,255,.08);background:rgba(10,12,18,.45);color:#9aa3b2;border-radius:999px;padding:7px 12px;font-family:system-ui,sans-serif;font-size:12px;cursor:pointer;backdrop-filter:blur(12px);pointer-events:auto}.close:hover,.pill:hover,.pill.active{color:#fff;border-color:rgba(255,255,255,.18)}
    .topbar{position:absolute;top:14px;right:16px;z-index:3;display:flex;align-items:center;gap:8px;pointer-events:auto}.toggle-chrome{font-size:15px;line-height:1;padding:6px 11px}.close{font-size:13px;line-height:1;padding:7px 11px}
    .autoscroll{font-size:11px;letter-spacing:.3px}.autoscroll.active{color:#ffcf6b;border-color:rgba(255,207,107,.4);background:rgba(255,207,107,.12)}
    .speed-hint{position:absolute;left:50%;bottom:108px;transform:translateX(-50%);z-index:4;font-family:system-ui,sans-serif;font-size:12px;color:#ffcf6b;background:rgba(10,12,18,.7);border:1px solid rgba(255,207,107,.3);border-radius:999px;padding:6px 14px;opacity:0;pointer-events:none;transition:opacity 140ms ease;backdrop-filter:blur(10px)}.speed-hint.show{opacity:1}
    .controls{position:absolute;left:50%;bottom:52px;transform:translateX(-50%);z-index:3;display:flex;align-items:center;gap:8px;font-family:system-ui,sans-serif;opacity:.72;transition:opacity 180ms ease;pointer-events:auto}.controls:hover{opacity:1}:host(:not(.show-controls)) .controls{display:none}.range{width:120px;accent-color:#ffcf6b;pointer-events:auto}
    .hud{position:absolute;left:0;right:0;bottom:20px;z-index:2;display:flex;flex-direction:column;align-items:center;gap:8px;font-family:system-ui,sans-serif;pointer-events:none}:host(:not(.show-progress)) .hud{display:none}.rail{width:min(320px,46vw);height:2px;background:rgba(255,255,255,.06);border-radius:9px;overflow:hidden}.fill{height:100%;width:0;background:linear-gradient(90deg,rgba(180,205,255,.7),#ffcf6b)}.meta{font-size:10.5px;color:#5d6573;letter-spacing:1px}
    @media (max-width:900px),(pointer:coarse){:host,:host(.hide-chrome){inset:0;min-height:100dvh}.stage{min-height:100dvh}.layer{width:min(86vw,560px);font-size:var(--im-font-size,32px);line-height:1.62;letter-spacing:.02px}:host(.position-top) .layer{top:24%}:host(.position-center) .layer{top:47%}:host(.position-bottom) .layer{top:65%}.topbar{top:calc(env(safe-area-inset-top,0px) + 10px);right:10px}.close{padding:8px 12px}.controls{bottom:calc(env(safe-area-inset-bottom,0px) + 72px);width:auto;justify-content:center;gap:10px;opacity:.82}.pill{padding:9px 13px;font-size:13px;min-width:44px}.hud{bottom:calc(env(safe-area-inset-bottom,0px) + 30px)}.rail{width:min(58vw,260px)}}
    @media (max-width:420px){.layer{width:84vw;font-size:var(--im-font-size,28px);line-height:1.6}.controls{transform:translateX(-50%) scale(.94);bottom:calc(env(safe-area-inset-bottom,0px) + 76px)}}
    :host(.perf-mode) .layer{will-change:auto}
    :host(.perf-mode) .txt{text-shadow:none!important;filter:none!important;background:none!important;-webkit-text-fill-color:#eef2f8!important;color:#eef2f8!important}
    :host(.perf-mode) .stage{perspective:none}
    .code-beat{width:min(900px,94vw);text-align:left;font-family:"JetBrains Mono","Fira Code",ui-monospace,Menlo,Consolas,monospace;font-size:clamp(12px,calc(var(--im-font-size,38px) * 0.5),22px);line-height:1.5;white-space:pre;overflow:auto;max-height:74vh;background:rgba(16,20,28,.82);border:1px solid rgba(140,170,220,.22);border-radius:14px;padding:18px 20px;color:#d7e2f2;box-shadow:0 18px 60px rgba(0,0,0,.5);-webkit-text-fill-color:#d7e2f2;text-shadow:none;background-clip:border-box}
    .code-beat .code-lang{display:block;font-family:system-ui,sans-serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#6f93c8;margin-bottom:10px}
    .html-card{width:min(900px,94vw);max-height:78vh;overflow:auto;text-align:left;background:rgba(16,20,28,.58);border:1px solid rgba(140,170,220,.18);border-radius:14px;padding:14px 16px;color:#edf1f7;-webkit-text-fill-color:initial;text-shadow:none;box-shadow:0 18px 60px rgba(0,0,0,.45);font-family:inherit;font-size:calc(var(--im-font-size,38px) * .58);line-height:1.55}
    .html-card details{margin:0}.html-card details>summary{cursor:default;list-style:none}.html-card summary::-webkit-details-marker{display:none}
    .overflow-beat{max-height:72vh;overflow:auto;padding-right:10px}
  `;
}

function createOverlay() {
  if (host) return;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${shadowCss()}</style><div class="topbar"><button class="pill toggle-chrome" title="Hide/show SillyTavern bars" aria-label="Toggle bars">⤢</button><button class="close" title="Exit" aria-label="Exit">✕</button></div><div class="stage"></div><div class="controls"><button class="pill font-down" title="Smaller text">A−</button><button class="pill font-up" title="Larger text">A+</button><button class="pill autoscroll" title="Auto-scroll (tap to toggle; press &amp; drag left/right to set speed)" aria-label="Auto-scroll">▶ auto</button></div><div class="hud"><div class="rail"><div class="fill"></div></div><div class="meta">— / —</div></div><div class="speed-hint">Auto-scroll speed</div>`;
  stage = root.querySelector('.stage');
  layers = [];
  fill = root.querySelector('.fill');
  meta = root.querySelector('.meta');
  speedHint = root.querySelector('.speed-hint');
  autoBtn = root.querySelector('.autoscroll');
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

function resetMotion() { index = 0; targetIndex = 0; visual = 0; targetVisual = 0; offset = 0; dragging = false; parkedEnd = false; parkedStart = false; }
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
  host.classList.remove('material-pearl', 'material-crystal', 'material-etched', 'material-liquid');
  host.classList.add(`material-${settings.material || 'pearl'}`);
  host.classList.remove('position-top', 'position-center', 'position-bottom');
  host.classList.add(`position-${settings.position || 'center'}`);
  host.classList.toggle('perf-mode', isPerfActive());
  host.style.setProperty('--im-font-size', `${Number(settings.fontSize) || DEFAULT_SETTINGS.fontSize}px`);
  root?.querySelector('.toggle-chrome')?.classList.toggle('active', !!settings.hideStChrome);
  document.body.classList.toggle('im-hide-st-chrome', !!settings.hideStChrome && host.classList.contains('open'));
}

function ensureLayerCount(count) {
  while (layers.length < count) {
    const layer = document.createElement('div');
    layer.className = 'layer';
    stage.appendChild(layer);
    layers.push(layer);
  }
  while (layers.length > count) {
    const layer = layers.pop();
    layer?.remove();
  }
}

function measureBeats() {
  beatHeights = [];
  beatCenters = [];
  beatScale = [];
  beatOverflow = [];
  if (!stage || !beats.length) return;
  const settings = getSettings();
  const shrinkOn = settings.shrinkOversizedBeats !== false;
  const maxH = (stage.clientHeight || window.innerHeight || 800) * 0.72;
  const measurer = document.createElement('div');
  measurer.style.position = 'absolute';
  measurer.style.visibility = 'hidden';
  measurer.style.opacity = '0';
  measurer.style.transform = 'none';
  measurer.style.left = '50%';
  stage.appendChild(measurer);
  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    measurer.style.fontSize = '';
    if (beat.isHtml) {
      measurer.className = 'layer im-measure html-card';
      measurer.innerHTML = `${beat.html}`;
    } else if (beat.isCode) {
      measurer.className = 'layer im-measure code-beat';
      measurer.innerHTML = `${beat.html}`;
    } else {
      measurer.className = 'layer im-measure';
      const who = beat.who ? `<span class="who">${escapeHtml(beat.who)}</span>` : '';
      measurer.innerHTML = `${who}<span class="txt">${beat.html}</span>`;
    }
    let h = measurer.offsetHeight || (Number(settings.fontSize) || DEFAULT_SETTINGS.fontSize) * 1.55;
    // Option A: shrink an oversized prose beat's font until it fits, then re-measure its true height.
    let scale = 1;
    if (shrinkOn && !beat.isHtml && !beat.isCode && h > maxH) {
      scale = Math.max(0.5, maxH / h);
      measurer.style.fontSize = `calc(var(--im-font-size, 38px) * ${scale.toFixed(3)})`;
      h = measurer.offsetHeight || h;
      if (h > maxH) {
        beatOverflow[i] = true;
        h = maxH;
      }
    }
    beatScale[i] = scale;
    beatHeights[i] = h;
  }
  measurer.remove();
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
  if (!beatCenters.length) return pos * (Number(getSettings().spread) || DEFAULT_SETTINGS.spread);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const frac = pos - lo;
  const at = i => {
    if (i < 0) return (beatCenters[0] ?? 0) - (-i) * ((Number(getSettings().spread) || DEFAULT_SETTINGS.spread));
    if (i >= beatCenters.length) {
      const last = beatCenters[beatCenters.length - 1] ?? 0;
      return last + (i - (beatCenters.length - 1)) * ((Number(getSettings().spread) || DEFAULT_SETTINGS.spread));
    }
    return beatCenters[i];
  };
  if (lo === hi) return at(lo);
  return at(lo) + (at(hi) - at(lo)) * frac;
}

function renderLayer(layer, beatIndex, d) {
  if (beatIndex < 0 || beatIndex >= beats.length) { layer.style.visibility = 'hidden'; layer.style.opacity = '0'; layer.innerHTML = ''; return; }
  const beat = beats[beatIndex];
  const settings = getSettings();
  const who = beat.who ? `<span class="who">${escapeHtml(beat.who)}</span>` : '';
  const id = settings.showMessageIds && beat.id ? `<span class="who">${escapeHtml(beat.id)}</span>` : '';
  layer.classList.remove('code-beat', 'html-card', 'overflow-beat');
  if (beatOverflow[beatIndex]) layer.classList.add('overflow-beat');
  if (beat.isHtml) {
    layer.classList.add('html-card');
    layer.innerHTML = `${beat.html}${id}`;
  } else if (beat.isCode) {
    layer.classList.add('code-beat');
    layer.innerHTML = `${beat.html}${id}`;
  } else {
    layer.innerHTML = `${who}<span class="txt">${beat.html}</span>${id}`;
  }
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
  const y = centerPixelFor(beatIndex) - centerPixelFor(visual);
  const flat = beat.isCode || beat.isHtml; // cards/code stay flat & readable, no rotary tilt
  // Auto-shrink oversized prose beats so they never overflow the screen (Option A).
  const shrink = (!flat && beatScale[beatIndex] != null) ? beatScale[beatIndex] : 1;
  layer.style.fontSize = (!flat && shrink < 1) ? `calc(var(--im-font-size, 38px) * ${shrink.toFixed(3)})` : '';
  const scale = flat ? (0.96 + 0.04 * Math.min(1, opacity * 4)) : (displayMode === 'teleprompter' ? 0.82 + 0.18 * Math.min(1, opacity * 3) : 0.9 + 0.1 * Math.min(1, opacity * 4));
  const rot = (!flat && displayMode === 'rotary') ? ` rotateX(${clamp(d, -2, 2) * -34}deg)` : '';
  layer.style.transform = `translate3d(-50%, calc(-50% + ${y.toFixed(2)}px), 0)${rot} scale(${scale.toFixed(3)})`;
  layer.style.opacity = opacity.toFixed(3);
  layer.style.filter = (!flat && contextPreview && dn > 0.25) ? `blur(${Math.min(2.2, dn * 1.15).toFixed(2)}px)` : 'none';
  layer.style.visibility = opacity < 0.002 ? 'hidden' : 'visible';
}

function paint() {
  if (!host?.classList.contains('open') || !beats.length) return;
  const center = Math.round(visual);
  const settings = getSettings();
  let ahead = Math.max(0, Number(settings.previewAhead) || 0);
  let behind = Math.max(0, Number(settings.previewBehind) || 0);
  if (settings.position === 'bottom') ahead = Math.min(ahead, 1);
  if (settings.position === 'top') behind = Math.min(behind, 1);
  const roles = [];
  for (let r = -behind; r <= ahead; r++) roles.push(r);
  ensureLayerCount(roles.length);
  roles.forEach((role, i) => renderLayer(layers[i], center + role, (center + role) - visual));
  const progress = beats.length > 1 ? visual / (beats.length - 1) : 1;
  fill.style.width = `${clamp(progress, 0, 1) * 100}%`;
  meta.textContent = `${Math.round(visual) + 1} / ${beats.length}`;
}

function openMessage(messageId) {
  const message = chat[messageId];
  // Hidden messages get is_system=true in SillyTavern; still allow opening them on explicit request.
  if (!message) return;
  activeMessageId = Number(messageId);
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
  targetVisual = clamp(targetVisual, 0, Math.max(0, beats.length - 1));
  host.classList.remove('closing'); host.style.opacity = ''; host.style.transition = '';
  host.classList.add('open');
  document.body.classList.add('immersive-mode-active');
  applyOverlaySettings();
  measureBeats();
  paint();
}

function finishCloseImmersive() { stopAutoScroll(); host?.classList.remove('open', 'closing'); if (host) { host.style.opacity = ''; host.style.transition = ''; } document.body.classList.remove('immersive-mode-active', 'im-hide-st-chrome'); }
function fadeCloseImmersive() { if (!host?.classList.contains('open') || host.classList.contains('closing')) return; host.classList.add('closing'); host.style.transition = 'opacity 420ms ease'; host.style.opacity = '0'; setTimeout(finishCloseImmersive, 430); }
function closeImmersive() { fadeCloseImmersive(); }

function startSettle(toIndex) {
  // Barrier-based exit: if already parked at a boundary and pushing further, exit.
  if (toIndex > index && attemptBoundaryExit(1)) return;
  if (toIndex < index && attemptBoundaryExit(-1)) return;
  toIndex = clamp(toIndex, 0, beats.length - 1);
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
    else { index = to; targetIndex = to; visual = to; offset = 0; transitionRaf = null; paint(); refreshParkState(); }
  }
  transitionRaf = requestAnimationFrame(step);
}

function thresholdResolve() {
  const threshold = Number(getSettings().threshold) || getWeight().threshold;
  const base = Math.round(clamp(visual, 0, beats.length - 1));
  if (offset >= threshold) startSettle(base + 1);
  else if (offset <= -threshold) startSettle(base - 1);
  else refreshParkState();
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
      refreshParkState();
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

function startGlide(delta) {
  if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = null; }
  glideVelocity += delta * 0.18;
  lastGlideTs = performance.now();
  if (glideRaf) return;
  const step = now => {
    const dt = Math.min(2.2, Math.max(0.5, (now - lastGlideTs) / 16.67));
    lastGlideTs = now;
    visual = clamp(visual + glideVelocity * dt, 0, beats.length - 1);
    if (visual <= 0 || visual >= beats.length - 1) glideVelocity = 0;
    glideVelocity *= Math.pow(0.925, dt);
    targetVisual = visual;
    updateFromVisualPosition();
    paint();
    if (Math.abs(glideVelocity) < 0.0009) {
      glideVelocity = 0;
      glideRaf = null;
      refreshParkState();
      return;
    }
    glideRaf = requestAnimationFrame(step);
  };
  glideRaf = requestAnimationFrame(step);
}

function flingWith(velocity) {
  if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = null; }
  glideVelocity = velocity;
  lastGlideTs = performance.now();
  if (glideRaf) return;
  const step = now => {
    const dt = Math.min(2.2, Math.max(0.5, (now - lastGlideTs) / 16.67));
    lastGlideTs = now;
    visual = clamp(visual + glideVelocity * dt, 0, beats.length - 1);
    if (visual <= 0 || visual >= beats.length - 1) glideVelocity = 0;
    glideVelocity *= Math.pow(0.94, dt);
    targetVisual = visual;
    updateFromVisualPosition();
    paint();
    if (Math.abs(glideVelocity) < 0.0009) { glideVelocity = 0; glideRaf = null; refreshParkState(); return; }
    glideRaf = requestAnimationFrame(step);
  };
  glideRaf = requestAnimationFrame(step);
}

function inputStarted() {
  if (transitionRaf) {
    cancelAnimationFrame(transitionRaf);
    transitionRaf = null;
  }
  // Manual interaction cancels auto-scroll.
  if (autoScrollRaf) { stopAutoScroll(); getSettings().autoScroll = false; }
  updateFromVisualPosition();
}

function startAutoScroll() {
  if (autoScrollRaf) return;
  autoScrollLastTs = performance.now();
  if (autoBtn) autoBtn.classList.add('active');
  const step = now => {
    const dt = Math.min(3, Math.max(0.5, (now - autoScrollLastTs) / 16.67));
    autoScrollLastTs = now;
    if (dragging || transitionRaf || glideRaf) { autoScrollRaf = requestAnimationFrame(step); return; }
    const speed = Number(getSettings().autoScrollSpeed) || DEFAULT_SETTINGS.autoScrollSpeed;
    visual = clamp(visual + (speed / 60) * dt, 0, beats.length - 1);
    targetVisual = visual;
    updateFromVisualPosition();
    paint();
    if (visual >= beats.length - 1) { stopAutoScroll(); refreshParkState(); return; }
    autoScrollRaf = requestAnimationFrame(step);
  };
  autoScrollRaf = requestAnimationFrame(step);
}

function stopAutoScroll() {
  if (autoScrollRaf) { cancelAnimationFrame(autoScrollRaf); autoScrollRaf = null; }
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
    const settings = getSettings();
    const direction = event.deltaY > 0 ? 1 : -1;
    if (settings.scrollBehavior === 'swipe' || settings.scrollMode === 'step') {
      startSettle(targetIndex + direction);
      return;
    }
    inputStarted();
    const delta = event.deltaY * getWeight().wheel;
    if (settings.scrollFeel === 'glide') startGlide(delta);
    else smoothDragTo(targetVisual + delta);
  }, { passive: false });
  stage.addEventListener('pointerdown', event => { dragging = true; inputStarted(); if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = null; } if (glideRaf) { cancelAnimationFrame(glideRaf); glideRaf = null; glideVelocity = 0; } dragStartX = event.clientX; dragStartY = event.clientY; dragStartVisual = visual; dragStartOffset = offset; dragStartParkedEnd = parkedEnd; dragStartParkedStart = parkedStart; pointerVel = 0; lastMoveY = event.clientY; lastMoveTs = performance.now(); stage.classList.add('drag'); stage.setPointerCapture(event.pointerId); });
  stage.addEventListener('pointermove', event => {
    if (!dragging) return;
    const stepSize = Number(getSettings().spread) || DEFAULT_SETTINGS.spread;
    visual = clamp(dragStartVisual - (event.clientY - dragStartY) / stepSize, 0, beats.length - 1);
    targetVisual = visual;
    updateFromVisualPosition();
    paint();
    const now = performance.now();
    const dtMs = now - lastMoveTs;
    if (dtMs > 0) {
      // beats moved per frame from the pixel delta since last move
      const beatsPerPx = 1 / stepSize;
      const instVel = -((event.clientY - lastMoveY) * beatsPerPx) * (16.67 / dtMs);
      pointerVel = pointerVel * 0.5 + instVel * 0.5;
      lastMoveY = event.clientY;
      lastMoveTs = now;
    }
  });
  stage.addEventListener('pointerup', event => {
    if (!dragging) return;
    dragging = false;
    stage.classList.remove('drag');
    const settings = getSettings();
    const dx = event.clientX - dragStartX;
    const dy = event.clientY - dragStartY;
    // Horizontal swipe = discrete prev/next (mobile)
    if (settings.mobileSwipeNavigation && Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.25) {
      offset = 0;
      startSettle(targetIndex + (dx < 0 ? 1 : -1));
      return;
    }
    // Barrier-based exit: if this drag started while parked at a boundary and pushed further toward it, exit.
    if (dragStartParkedEnd && dy < -6 && atEndBoundary() && settings.exitAtEnd) { fadeCloseImmersive(); return; }
    if (dragStartParkedStart && dy > 6 && atStartBoundary() && settings.exitAtStart) { fadeCloseImmersive(); return; }
    // Vertical release: fling with momentum (native-feeling), regardless of touch or mouse
    if (settings.scrollBehavior === 'drag' && Math.abs(pointerVel) > 0.012) {
      flingWith(clamp(pointerVel, -0.9, 0.9));
      return;
    }
    if (settings.scrollBehavior !== 'drag') thresholdResolve();
    else refreshParkState();
  });
  document.addEventListener('keydown', event => { if (!host?.classList.contains('open')) return; if (['ArrowDown', 'ArrowRight', 'Space'].includes(event.code)) { event.preventDefault(); event.stopPropagation(); startSettle(targetIndex + 1); } if (['ArrowUp', 'ArrowLeft'].includes(event.code)) { event.preventDefault(); event.stopPropagation(); startSettle(targetIndex - 1); } if (event.code === 'Escape') { event.preventDefault(); event.stopPropagation(); closeImmersive(); } }, true);
  let resizeTimer = null;
  window.addEventListener('resize', () => { if (!host?.classList.contains('open')) return; clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { applyOverlaySettings(); remeasureAndPaint(); }, 90); });
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
  container.find('.im_exit_at_end').prop('checked', settings.exitAtEnd).on('change', function () { settings.exitAtEnd = !!$(this).prop('checked'); saveSettings(); });
  container.find('.im_exit_at_start').prop('checked', settings.exitAtStart).on('change', function () { settings.exitAtStart = !!$(this).prop('checked'); saveSettings(); });
  container.find('.im_show_inmode_controls').prop('checked', settings.showInModeControls).on('change', function () { settings.showInModeControls = !!$(this).prop('checked'); saveSettings(); applyOverlaySettings(); });
  container.find('.im_hide_st_chrome').prop('checked', settings.hideStChrome).on('change', function () { settings.hideStChrome = !!$(this).prop('checked'); saveSettings(); applyOverlaySettings(); });
  container.find('.im_context_preview').prop('checked', settings.contextPreview).on('change', function () { settings.contextPreview = !!$(this).prop('checked'); saveSettings(); paint(); });
  container.find('.im_shrink_oversized').prop('checked', settings.shrinkOversizedBeats).on('change', function () { settings.shrinkOversizedBeats = !!$(this).prop('checked'); saveSettings(); remeasureAndPaint(); });
  container.find('.im_prevent_code_html').prop('checked', settings.preventCodeHtmlCapture).on('change', function () { settings.preventCodeHtmlCapture = !!$(this).prop('checked'); saveSettings(); });
  container.find('.im_use_rendered_html').prop('checked', settings.useRenderedHtml).on('change', function () { settings.useRenderedHtml = !!$(this).prop('checked'); saveSettings(); if (host && activeMessageId !== null) remeasureAndPaint(); });
  container.find('.im_skip_details_blocks').prop('checked', settings.skipDetailsBlocks).on('change', function () { settings.skipDetailsBlocks = !!$(this).prop('checked'); saveSettings(); if (host && activeMessageId !== null) remeasureAndPaint(); });
  container.find('.im_exclude_bracket_pipes').prop('checked', settings.excludeBracketPipes).on('change', function () { settings.excludeBracketPipes = !!$(this).prop('checked'); saveSettings(); });
  container.find('.im_mobile_swipe').prop('checked', settings.mobileSwipeNavigation).on('change', function () { settings.mobileSwipeNavigation = !!$(this).prop('checked'); saveSettings(); });
  container.find('.im_stream_capture').prop('checked', settings.streamCapture).on('change', function () { settings.streamCapture = !!$(this).prop('checked'); saveSettings(); });
  container.find('.im_show_send_button').prop('checked', settings.showSendButton).on('change', function () { settings.showSendButton = !!$(this).prop('checked'); saveSettings(); updateSendButtonVisibility(); });
  container.find('.im_extraction_mode').val(settings.extractionMode).on('change', function () { settings.extractionMode = String($(this).val() || 'sentence'); saveSettings(); if (host && activeMessageId !== null) remeasureAndPaint(); });
  container.find('.im_content_mode').val(settings.contentMode).on('change', function () { settings.contentMode = String($(this).val() || 'rp'); saveSettings(); if (host && activeMessageId !== null) remeasureAndPaint(); });
  container.find('.im_special_code').prop('checked', settings.specialCode).on('change', function () { settings.specialCode = !!$(this).prop('checked'); saveSettings(); if (host && activeMessageId !== null) remeasureAndPaint(); });
  container.find('.im_special_html').prop('checked', settings.specialHtml).on('change', function () { settings.specialHtml = !!$(this).prop('checked'); saveSettings(); if (host && activeMessageId !== null) remeasureAndPaint(); });
  container.find('.im_auto_scroll').prop('checked', settings.autoScroll).on('change', function () { settings.autoScroll = !!$(this).prop('checked'); saveSettings(); if (host && host.classList.contains('open')) setAutoScroll(settings.autoScroll); });
  container.find('.im_auto_scroll_speed').val(asSpeedToFrac(Number(settings.autoScrollSpeed) || DEFAULT_SETTINGS.autoScrollSpeed)).on('input change', function () { settings.autoScrollSpeed = asFracToSpeed(Number($(this).val()) || 0); saveSettings(); container.find('.im_auto_scroll_speed_value').text(settings.autoScrollSpeed.toFixed(2)); });
  container.find('.im_auto_scroll_speed_value').text((Number(settings.autoScrollSpeed) || DEFAULT_SETTINGS.autoScrollSpeed).toFixed(2));
  const updatePerfStatus = () => container.find('.im_perf_status').text('Currently: ' + (isPerfActive() ? 'ON' : 'off') + (isMobileViewport() ? ' (mobile detected)' : ' (desktop)'));
  container.find('.im_mobile_performance').val(settings.mobilePerformance).on('change', function () { settings.mobilePerformance = String($(this).val() || 'auto'); saveSettings(); applyOverlaySettings(); updatePerfStatus(); });
  updatePerfStatus();
  container.find('.im_display_mode').val(settings.displayMode).on('change', function () { settings.displayMode = String($(this).val() || 'rotary'); saveSettings(); paint(); });
  container.find('.im_position').val(settings.position).on('change', function () { settings.position = String($(this).val() || 'center'); saveSettings(); });
  container.find('.im_scroll_mode').val(settings.scrollMode).on('change', function () { settings.scrollMode = String($(this).val() || 'threshold'); saveSettings(); });
  container.find('.im_scroll_behavior').val(settings.scrollBehavior).on('change', function () { settings.scrollBehavior = String($(this).val() || 'drag'); saveSettings(); });
  container.find('.im_scroll_feel').val(settings.scrollFeel).on('change', function () { settings.scrollFeel = String($(this).val() || 'glide'); saveSettings(); });
  container.find('.im_weight').val(settings.weight).on('change', function () { settings.weight = String($(this).val() || 'heavy'); saveSettings(); });
  container.find('.im_material').val(settings.material).on('change', function () { settings.material = String($(this).val() || 'pearl'); saveSettings(); applyOverlaySettings(); });
  container.find('.im_threshold').val(settings.threshold).on('input change', function () { settings.threshold = Number($(this).val()) || DEFAULT_SETTINGS.threshold; saveSettings(); });
  container.find('.im_font_size').val(settings.fontSize).on('input change', function () { settings.fontSize = Number($(this).val()) || DEFAULT_SETTINGS.fontSize; saveSettings(); applyOverlaySettings(); remeasureAndPaint(); });
  container.find('.im_spread').val(settings.spread).on('input change', function () { settings.spread = Number($(this).val()) || DEFAULT_SETTINGS.spread; saveSettings(); remeasureAndPaint(); });
  const updatePreviewValues = () => {
    const current = getSettings();
    container.find('.im_preview_both_value').text(String(Math.max(Number(current.previewAhead) || 0, Number(current.previewBehind) || 0)));
    container.find('.im_preview_ahead_value').text(String(Number(current.previewAhead) || 0));
    container.find('.im_preview_behind_value').text(String(Number(current.previewBehind) || 0));
  };
  container.find('.im_preview_both').val(Math.max(settings.previewAhead, settings.previewBehind));
  container.find('.im_preview_ahead').val(settings.previewAhead);
  container.find('.im_preview_behind').val(settings.previewBehind);
  updatePreviewValues();
  container.off('input.immersivePreview change.immersivePreview')
    .on('input.immersivePreview change.immersivePreview', '.im_preview_both', function () {
      const value = Number($(this).val()) || 0;
      const current = getSettings();
      current.previewAhead = value;
      current.previewBehind = value;
      container.find('.im_preview_ahead').val(value);
      container.find('.im_preview_behind').val(value);
      updatePreviewValues();
      saveSettings(); paint();
    })
    .on('input.immersivePreview change.immersivePreview', '.im_preview_ahead', function () {
      getSettings().previewAhead = Number($(this).val()) || 0;
      updatePreviewValues();
      saveSettings(); paint();
    })
    .on('input.immersivePreview change.immersivePreview', '.im_preview_behind', function () {
      getSettings().previewBehind = Number($(this).val()) || 0;
      updatePreviewValues();
      saveSettings(); paint();
    });
  container.find('.im_open_now').on('click', openLatestAssistant);
  container.find('.im_close_now').on('click', closeImmersive);
}

function registerEvents() { eventSource.makeLast(event_types.CHARACTER_MESSAGE_RENDERED, (messageId, type) => { const message = chat[messageId]; if (!message || message.is_user || message.is_system) return; if (getSettings().autoOpen && ['normal', 'continue', 'swipe'].includes(type || 'normal')) openMessage(Number(messageId)); }); eventSource.on(event_types.STREAM_TOKEN_RECEIVED, updateStreamingMessage); eventSource.on(event_types.CHAT_CHANGED, closeImmersive); }
function registerSlashCommand() { SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'immersive', callback: () => { openLatestAssistant(); return ''; }, helpString: 'Open Immersive Mode for the latest assistant message.' })); }
function exposePublicApi() { globalThis.SillyTavernImmersiveMode = { openLatest: openLatestAssistant, openMessage, close: closeImmersive, debugOpenHtml(html, name = 'Seraphine') { createOverlay(); activeMessageId = -1; beats = buildBeatsFromMessage({ mes: String(html || ''), name, is_user: false, is_system: false }, 'debug'); resetMotion(); host.classList.remove('closing'); host.style.opacity = ''; host.style.transition = ''; host.classList.add('open'); document.body.classList.add('immersive-mode-active'); applyOverlaySettings(); measureBeats(); paint(); }, getState() { return { activeMessageId, beats: beats.map(b => stripTags(b.html)), beatHtml: beats.map(b => b.html), index, targetIndex, visual, targetVisual, open: host?.classList.contains('open') || false, renderedLayers: layers.length }; }, debugSegmentHtml(html) { return buildBeatsFromMessage({ mes: String(html || ''), name: 'debug', is_user: false, is_system: false }, 'debug').map(b => stripTags(b.html)); }, debugNormalizeHtml(html) { currentPreserved = []; const normalized = normalizeMessageText(String(html || ''), (getSettings().contentMode || 'rp') === 'general'); return { normalized, tokens: tokenizeIntoBeats(normalized), currentPreserved }; }, debugSetSettings(next) { Object.assign(getSettings(), next || {}); saveSettings(); if (host) applyOverlaySettings(); } }; }

async function init() { if (initialized) return; initialized = true; getSettings(); await addSettingsUi(); createOverlay(); addMessageButton(); addSendButton(); attachDelegatedHandlers(); registerEvents(); registerSlashCommand(); exposePublicApi(); console.log('[Immersive Mode] Loaded layered reader engine.'); }
init().catch(error => { console.error('[Immersive Mode] Init failed:', error); toastr?.error?.(`Init failed: ${error?.message || error}`, 'Immersive Mode'); });
