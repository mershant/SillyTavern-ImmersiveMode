// Visual effect presets and their measured cost.
//
// Cost is how much longer an average animation frame takes while scrolling, with that one effect
// on and every other effect off, compared with all effects off. It comes from
// scripts/measure-effects.mjs (median of 3 interleaved runs, about ±2 points run to run), run on
// the STD test server: 2 CPU cores, no graphics card, so the browser draws everything in
// software. A real phone or PC draws far faster, so the percentages are for comparing effects,
// not a promise of frame rate. Re-run the script and update these numbers when an effect changes.

export const MEASURED_ON = 'STD test server, 2 cores, software rendering, 2026-10-17';

// Keyed by setting name, or `setting:value` for choices.
export const EFFECT_COSTS = {
  focusBloom: 9,
  settleGlow: 3,
  lightSweep: 4,
  inkSettle: 2,
  breathing: 3,
  dialogueWarmth: 9,
  edgeTrace: 16,
  finishRing: 0, // on top of Edge trace, which it needs
  dawnGlow: 18,
  depthSway: 1,
  trailingLines: 3,
  focusVignette: 17,
  glassButtons: 2,
  'backdrop:frosted': 3,
  'backdrop:dim': 0,
  'railStyle:line': 0,
  'railStyle:ticks': 2,
  'railStyle:liquid': 0,
  'railStyle:capsule': 4,
  'railStyle:osmosis': 6,
  'material:etched': 0,
  'material:pearl': 5,
  'material:crystal': 16,
  'material:liquid': 44,
};

export function costTier(percent) {
  if (percent <= 3) return 'free';
  if (percent <= 8) return 'light';
  if (percent <= 20) return 'medium';
  return 'heavy';
}

// Presets set only the visual effects below; reading settings (font, position, text material,
// splitting) are left as they are.
const ALL_EFFECTS_OFF = {
  focusBloom: false, settleGlow: false, lightSweep: false, inkSettle: false, breathing: false,
  dialogueWarmth: false, edgeTrace: false, finishRing: false, dawnGlow: false, depthSway: false,
  trailingLines: false, focusVignette: false, glassButtons: false, edgeBounce: true,
  backdrop: 'dim', railStyle: 'line',
};

export const PRESETS = {
  full: {
    label: 'Full',
    note: 'Every effect on.',
    values: {
      ...ALL_EFFECTS_OFF,
      focusBloom: true, settleGlow: true, lightSweep: true, inkSettle: true, breathing: true,
      dialogueWarmth: true, edgeTrace: true, finishRing: true, dawnGlow: true, depthSway: true,
      trailingLines: true, focusVignette: true, glassButtons: true,
      backdrop: 'frosted', railStyle: 'osmosis',
    },
  },
  balanced: {
    label: 'Balanced',
    recommended: true,
    note: 'About a fifth of Full\'s cost. Keeps the effects you feel most and drops the three that cost most for the least: Dawn, Focus vignette and Dialogue warmth. Liquid line rail instead of Osmosis.',
    values: {
      ...ALL_EFFECTS_OFF,
      focusBloom: true, settleGlow: true, lightSweep: true, inkSettle: true, breathing: true,
      edgeTrace: true, finishRing: true, depthSway: true, trailingLines: true, glassButtons: true,
      backdrop: 'frosted', railStyle: 'liquid',
    },
  },
  light: {
    label: 'Light',
    note: 'Only effects that cost almost nothing: the line feedback and motion, frosted glass, Liquid line rail.',
    values: {
      ...ALL_EFFECTS_OFF,
      settleGlow: true, lightSweep: true, inkSettle: true, breathing: true, depthSway: true,
      trailingLines: true, glassButtons: true, backdrop: 'frosted', railStyle: 'liquid',
    },
  },
  minimal: {
    label: 'Minimal',
    note: 'No decoration. Keeps the edge bounce and a plain progress line.',
    values: { ...ALL_EFFECTS_OFF },
  },
};

// Measured cost of each whole preset (same method, two separate 3-run measurements averaged;
// Full varied 104-131 between measurements, so treat it as roughly double the frame time).
// Effects overlap, so a preset costs less than its effects added up.
export const PRESET_COSTS = { full: 120, balanced: 23, light: 6, minimal: 0 };

export const PRESET_KEYS = Object.keys(ALL_EFFECTS_OFF);

export function matchingPreset(settings) {
  for (const [name, preset] of Object.entries(PRESETS)) {
    if (PRESET_KEYS.every(key => settings[key] === preset.values[key])) return name;
  }
  return null;
}

// Cost of one setting's current value, from the single-effect measurements.
function costOf(settings, key) {
  const value = settings[key];
  if (typeof value === 'string') return EFFECT_COSTS[`${key}:${value}`] || 0;
  if (!value) return 0;
  if (key === 'finishRing' && !settings.edgeTrace) return 0;
  return EFFECT_COSTS[key] || 0;
}

// Estimated cost of the current settings. Starts from the most expensive measured preset whose
// effects are all still on, then adds the single-effect cost of anything on top of it. Exact for
// a preset; for a mix it leans high, because effects that run together share some work.
export function estimateCost(settings) {
  const material = EFFECT_COSTS[`material:${settings.material}`] || 0;
  const exact = matchingPreset(settings);
  if (exact) return { percent: PRESET_COSTS[exact] + material, preset: exact, measured: true };
  let best = 'minimal';
  for (const [name, preset] of Object.entries(PRESETS)) {
    const within = PRESET_KEYS.every(key => {
      const want = preset.values[key];
      if (typeof want === 'string') return settings[key] === want || costOf(preset.values, key) === 0;
      return !want || !!settings[key];
    });
    if (within && PRESET_COSTS[name] > PRESET_COSTS[best]) best = name;
  }
  const base = PRESETS[best].values;
  let extra = 0;
  for (const key of PRESET_KEYS) {
    const now = costOf(settings, key);
    const then = costOf(base, key);
    if (now > then) extra += now - then;
  }
  return { percent: PRESET_COSTS[best] + extra + material, preset: null, measured: false, from: best };
}
