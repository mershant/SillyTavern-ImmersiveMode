import assert from 'node:assert/strict';
import test from 'node:test';

import { EFFECT_COSTS, PRESETS, PRESET_COSTS, PRESET_KEYS, costTier, estimateCost, matchingPreset } from '../src/effects.js';


test('every preset sets every effect key, so applying one leaves nothing from the last', () => {
  for (const [name, preset] of Object.entries(PRESETS)) {
    for (const key of PRESET_KEYS) assert.ok(key in preset.values, `${name} is missing ${key}`);
  }
});


test('presets are recognised again after being applied', () => {
  for (const [name, preset] of Object.entries(PRESETS)) {
    assert.equal(matchingPreset({ ...preset.values, material: 'etched' }), name);
  }
});


test('exactly one preset is the recommended one, and it costs less than Full', () => {
  const recommended = Object.entries(PRESETS).filter(([, p]) => p.recommended).map(([n]) => n);
  assert.deepEqual(recommended, ['balanced']);
  assert.ok(PRESET_COSTS.balanced < PRESET_COSTS.full / 3);
});


test('the estimate is the measured value for a preset and grows with costly additions', () => {
  const balanced = { ...PRESETS.balanced.values, material: 'etched' };
  assert.deepEqual(estimateCost(balanced), { percent: PRESET_COSTS.balanced, preset: 'balanced', measured: true });
  const withDawn = estimateCost({ ...balanced, dawnGlow: true });
  assert.equal(withDawn.measured, false);
  assert.equal(withDawn.percent, PRESET_COSTS.balanced + EFFECT_COSTS.dawnGlow);
  const crystal = estimateCost({ ...balanced, material: 'crystal' });
  assert.equal(crystal.percent, PRESET_COSTS.balanced + EFFECT_COSTS['material:crystal']);
});


test('turning effects off never raises the estimate', () => {
  const full = { ...PRESETS.full.values, material: 'etched' };
  for (const key of PRESET_KEYS) {
    if (typeof full[key] !== 'boolean' || !full[key]) continue;
    assert.ok(estimateCost({ ...full, [key]: false }).percent <= estimateCost(full).percent, key);
  }
});


test('cost tiers', () => {
  assert.equal(costTier(0), 'free');
  assert.equal(costTier(5), 'light');
  assert.equal(costTier(16), 'medium');
  assert.equal(costTier(44), 'heavy');
});
