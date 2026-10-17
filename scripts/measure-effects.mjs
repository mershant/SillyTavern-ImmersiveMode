// Measures what each visual effect costs while reading, in the isolated STD host.
//
//   node scripts/measure-effects.mjs [--url http://127.0.0.1:8001] [--runs 3]
//
// Each case runs the same scripted reading session (wheel glide, key steps, a drag fling) on the
// same long message and records every animation frame. The baseline has every optional effect
// off; each case turns one effect on. Cost = how much longer the average frame takes than the
// baseline. Never presses Send, so no model request is made.
//
// The numbers belong to the machine that ran them. They are useful as a ranking: an effect that
// is expensive here is expensive everywhere, but a phone with a good GPU pays less for blur.

import { createRequire } from 'node:module';
import { PRESETS } from '../src/effects.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH
  || '/home/opc/.nvm/versions/node/v22.14.0/lib/node_modules/@playwright/cli/node_modules/playwright/index.js');

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : fallback; };
const URL = arg('--url', 'http://127.0.0.1:8001');
const RUNS = Number(arg('--runs', 3));
const ONLY = arg('--only', '');
const STORAGE = arg('--storage-state', '/home/opc/.local/share/openchamber/playwright/std-storage-state.json');

const OFF = {
  focusBloom: false, settleGlow: false, lightSweep: false, inkSettle: false, breathing: false,
  dialogueWarmth: false, edgeTrace: false, dawnGlow: false, finishRing: false, depthSway: false,
  trailingLines: false, focusVignette: false, glassButtons: false, edgeBounce: false,
  backdrop: 'dim', railStyle: 'line', material: 'etched', keepMessageColors: true,
  mobilePerformance: 'off', autoScroll: false, displayMode: 'rotary', contextPreview: true,
  position: 'center', showProgress: true, showInModeControls: true,
};

const CASES = [
  ['baseline', {}],
  ['focusBloom', { focusBloom: true }],
  ['settleGlow', { settleGlow: true }],
  ['lightSweep', { lightSweep: true }],
  ['inkSettle', { inkSettle: true }],
  ['breathing', { breathing: true }],
  ['dialogueWarmth', { dialogueWarmth: true }],
  ['edgeTrace', { edgeTrace: true }],
  ['dawnGlow', { dawnGlow: true }],
  ['finishRing', { finishRing: true, edgeTrace: true }],
  ['depthSway', { depthSway: true }],
  ['trailingLines', { trailingLines: true }],
  ['focusVignette', { focusVignette: true }],
  ['glassButtons', { glassButtons: true }],
  ['backdrop:frosted', { backdrop: 'frosted' }],
  ['rail:osmosis', { railStyle: 'osmosis' }],
  ['rail:liquid', { railStyle: 'liquid' }],
  ['rail:capsule', { railStyle: 'capsule' }],
  ['rail:ticks', { railStyle: 'ticks' }],
  ['material:pearl', { material: 'pearl' }],
  ['material:crystal', { material: 'crystal' }],
  ['material:liquid', { material: 'liquid' }],
  ['everything', {
    focusBloom: true, settleGlow: true, lightSweep: true, inkSettle: true, breathing: true,
    dialogueWarmth: true, edgeTrace: true, dawnGlow: true, finishRing: true, depthSway: true,
    trailingLines: true, focusVignette: true, glassButtons: true, edgeBounce: true,
    backdrop: 'frosted', railStyle: 'osmosis',
  }],
];

// Presets are measured exactly as shipped, from src/effects.js.
for (const [name, preset] of Object.entries(PRESETS)) CASES.push([`preset:${name}`, preset.values]);

const MESSAGE = '<p>' + [
  'The conference had finally wound down for the evening, leaving the hotel corridors unusually quiet.',
  'Inside Tony\'s room, the city glittered beyond the broad windows, while warm amber light softened the space.',
  '"Come on. We\'ve spent all day pretending to be respectable professionals."',
  'Dave raised an eyebrow.', '"You\'ve spent all day pretending."', 'Tony grinned.', '"Fair point."',
  'He reached for his glass, turning it slowly between his fingers.',
  '"Right then, how about a game of truth or dare? A perfect icebreaker for our new friend."',
  'Tony settled back against the desk, utterly self-assured.',
  '"Rules are simple. Pick truth, answer honestly. Pick dare, and you do what you\'re told."',
  'The room fell briefly quiet, the city lights shimmering against the windows.',
  'Tony lifted his glass in invitation, his expression challenging and unmistakably cocky.',
  '"OK Eloise, since you\'re new to the company, you have to go first - truth or dare?"',
].join(' ') + '</p>';

async function session(page) {
  await page.evaluate(() => {
    window.__imFrames = [];
    let last = performance.now();
    window.__imRec = true;
    const tick = now => { window.__imFrames.push(now - last); last = now; if (window.__imRec) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await page.mouse.move(640, 430);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 200); await page.waitForTimeout(16); }
  await page.waitForTimeout(1400);
  for (let i = 0; i < 4; i++) { await page.keyboard.press('ArrowUp'); await page.waitForTimeout(450); }
  await page.mouse.move(640, 600);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(640, 600 - i * 30); await page.waitForTimeout(12); }
  await page.mouse.up();
  await page.waitForTimeout(1300);
  return page.evaluate(() => { window.__imRec = false; return window.__imFrames.slice(1); });
}

const stats = frames => {
  const sorted = [...frames].sort((a, b) => a - b);
  const mean = frames.reduce((a, b) => a + b, 0) / frames.length;
  return { mean, p95: sorted[Math.floor(sorted.length * 0.95)], slow: frames.filter(f => f > 25).length / frames.length };
};
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium-browser' });
  const context = await browser.newContext({ storageState: STORAGE, viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  await page.goto(URL);
  await page.waitForFunction("performance.getEntriesByName('[init] complete').length > 0", null, { timeout: 120000 });
  await page.waitForFunction(() => !!globalThis.SillyTavernImmersiveMode, null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => [...document.querySelectorAll('dialog[open]')].forEach(d => { const b = [...d.querySelectorAll('.menu_button, button')].find(x => /^(Later|Close|Cancel)$/i.test((x.textContent || '').trim())); b ? b.click() : d.close(); }));
  await page.addStyleTag({ content: '#scp-window{display:none!important}' });
  await page.evaluate(() => document.activeElement?.blur?.());
  const saved = await page.evaluate(() => JSON.parse(JSON.stringify(SillyTavern.getContext().extensionSettings.immersiveMode)));
  const results = {};
  // Runs are interleaved (every case once, then again) so background load spreads evenly.
  for (let run = 0; run < RUNS; run++) {
    for (const [name, change] of CASES.filter(([n]) => !ONLY || n === 'baseline' || ONLY.split(',').includes(n))) {
      await page.evaluate(next => globalThis.SillyTavernImmersiveMode.debugSetSettings(next), { ...OFF, ...change });
      await page.evaluate(html => globalThis.SillyTavernImmersiveMode.debugOpenHtml(html, 'Truth or Dare'), MESSAGE);
      await page.waitForTimeout(500);
      const s = stats(await session(page));
      (results[name] ||= []).push(s);
      await page.evaluate(() => globalThis.SillyTavernImmersiveMode.close());
      await page.waitForTimeout(500);
    }
  }
  await page.evaluate(next => globalThis.SillyTavernImmersiveMode.debugSetSettings(next), saved);
  await browser.close();
  const base = median(results.baseline.map(r => r.mean));
  const table = CASES.filter(([name]) => results[name]).map(([name]) => {
    const mean = median(results[name].map(r => r.mean));
    return { name, frameMs: +mean.toFixed(2), extraMs: +(mean - base).toFixed(2), extraPct: +(((mean - base) / base) * 100).toFixed(1), p95Ms: +median(results[name].map(r => r.p95)).toFixed(1), slowFrames: +(median(results[name].map(r => r.slow)) * 100).toFixed(1) };
  });
  console.log(JSON.stringify({ runs: RUNS, baselineFrameMs: +base.toFixed(2), table }, null, 2));
}

main().catch(error => { console.error(error); process.exit(2); });
