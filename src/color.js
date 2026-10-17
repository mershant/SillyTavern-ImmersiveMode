// Readable message colors.
//
// Messages can carry their own colors (written by the model, or added by a
// preset's regex). The reader keeps those colors, but it draws text on a dark
// surface, so a color chosen for a light chat theme can vanish. readableColor()
// keeps the hue and saturation and only raises lightness until the color meets
// a minimum contrast against the reader's background.

export const READER_BACKGROUND = { r: 16, g: 18, b: 24 };
export const MIN_CONTRAST = 4.5;

export function parseRgb(value) {
  const hex = String(value || '').trim().match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  const match = String(value || '').match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/i);
  if (!match) return null;
  let a = match[4] === undefined ? 1 : parseFloat(match[4]);
  if (String(match[4] || '').endsWith('%')) a /= 100;
  return { r: +match[1], g: +match[2], b: +match[3], a };
}

function channel(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function luminance({ r, g, b }) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h / 6, s, l };
}

function hslToRgb({ h, s, l }) {
  if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
  const hue = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue(p, q, h + 1 / 3) * 255),
    g: Math.round(hue(p, q, h) * 255),
    b: Math.round(hue(p, q, h - 1 / 3) * 255),
  };
}

// Returns an `rgb(...)` string that keeps the color's hue but is readable on the
// reader background, or null when the input is not a visible color.
export function readableColor(value, background = READER_BACKGROUND, minRatio = MIN_CONTRAST) {
  const rgb = typeof value === 'string' ? parseRgb(value) : value;
  if (!rgb || rgb.a === 0) return null;
  let color = { r: rgb.r, g: rgb.g, b: rgb.b };
  if (contrast(color, background) < minRatio) {
    const hsl = rgbToHsl(color);
    let lo = hsl.l;
    let hi = 1;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (contrast(hslToRgb({ ...hsl, l: mid }), background) >= minRatio) hi = mid;
      else lo = mid;
    }
    color = hslToRgb({ ...hsl, l: hi });
  }
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}
