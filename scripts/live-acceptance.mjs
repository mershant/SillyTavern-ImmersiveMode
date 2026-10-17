// Live acceptance for Immersive Mode in the isolated STD host.
//
// Run after `st-extension smoke-std` has installed the extension:
//   node scripts/live-acceptance.mjs [--url http://127.0.0.1:8001] [--shots /tmp/opencode/im-shots]
//
// Uses the kit's saved STD login. Never presses Send, so no model request is made.
// Covers the ordinary reading path: open, scroll, fling, edge bounce + two-push exit,
// message colors, live HTML cards, tall-card inner scrolling, bottom-position fit, and the drawer.

import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const playwrightPath = process.env.PLAYWRIGHT_PATH
  || '/home/opc/.nvm/versions/node/v22.14.0/lib/node_modules/@playwright/cli/node_modules/playwright/index.js';
const { chromium } = require(playwrightPath);

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const URL = arg('--url', 'http://127.0.0.1:8001');
const SHOTS = arg('--shots', '/tmp/opencode/im-shots');
const STORAGE = arg('--storage-state', '/home/opc/.local/share/openchamber/playwright/std-storage-state.json');
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); };

const COLOR_HTML = [
  '<p>The lamps came on one at a time. <font color="#1a1a6e">"You\'re late," said a voice in navy.</font> She did not turn.</p>',
  '<p><span style="color:#ffcf6b">A golden sentence that is fine as it is.</span></p>',
  '<p><span style="color:#550000">This dark red runs across two sentences. It should stay red in both.</span></p>',
].join('');

const CARD_HTML = [
  '<p>Before the card.</p>',
  '<div class="status-card" style="border:1px solid #6a8;padding:8px"><b>Status</b><br>',
  Array.from({ length: 60 }, (_, i) => `<span style="color:#9cf">Row ${i + 1}</span>: value ${i + 1}<br>`).join(''),
  '</div>',
  '<p>After the card.</p>',
].join('');

const LONG_HTML = '<p>' + Array.from({ length: 12 }, (_, i) => `Sentence number ${i + 1} keeps the story moving along the harbor road.`).join(' ') + '</p>';

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium-browser' });
  const errors = [];
  const modelRequests = [];
  for (const viewport of [{ width: 1280, height: 860, name: 'desktop' }, { width: 390, height: 844, name: 'phone', mobile: true }]) {
    const context = await browser.newContext({
      storageState: STORAGE,
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: !!viewport.mobile,
      hasTouch: !!viewport.mobile,
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(`${viewport.name}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && /immersive/i.test(m.text())) errors.push(`${viewport.name}: ${m.text()}`); });
    page.on('request', r => { if (/\/api\/(backends|openai|textgen|novelai|horde)\/.*generate|chat-completions\/generate/i.test(r.url())) modelRequests.push(r.url()); });
    await page.goto(URL);
    await page.waitForFunction("performance.getEntriesByName('[init] complete').length > 0", null, { timeout: 120000 });
    await page.waitForFunction(() => !!globalThis.SillyTavernImmersiveMode, null, { timeout: 30000 });
    // Host popups (such as the update notice) are closed with their non-acting button.
    const dismissPopups = async () => {
      for (let tries = 0; tries < 4; tries++) {
        const open = await page.evaluate(() => [...document.querySelectorAll('dialog[open]')].map(d => {
          const later = [...d.querySelectorAll('.menu_button, button')].find(b => /^(Later|Close|Cancel)$/i.test((b.textContent || '').trim()));
          if (later) later.click(); else d.close?.();
          return true;
        }).length);
        if (!open) break;
        await page.waitForTimeout(600);
      }
      await page.evaluate(() => document.activeElement?.blur?.());
    };
    await page.waitForTimeout(2500);
    await dismissPopups();
    const tag = viewport.name;

    const api = (fn, ...args) => page.evaluate(([f, a]) => globalThis.SillyTavernImmersiveMode[f](...a), [fn, args]);
    const state = () => api('getState');
    // Waits for the reader to come to rest (no move running) instead of a fixed time, so a slow
    // machine does not fail a check that is only waiting on frames.
    const settle = async (ms = 4000) => { const end = Date.now() + ms; let st = await state(); while (Date.now() < end) { if (!st.moving) return st; await page.waitForTimeout(60); st = await state(); } return st; };
    const shadow = (fn) => page.evaluate(`(() => { const host = [...document.body.children].find(el => el.shadowRoot && el.shadowRoot.querySelector('.stage')); return (${fn})(host.shadowRoot, host); })()`);
    const stageBox = async () => shadow('(r) => { const b = r.querySelector(".stage").getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }');

    // Known starting settings for this run; the user-facing defaults are what new installs get.
    await api('debugSetSettings', {
      position: 'bottom', displayMode: 'rotary', scrollMode: 'free', scrollFeel: 'glide', edgeBounce: true,
      exitAtEnd: true, exitAtStart: true, focusBloom: true, settleGlow: true, railStyle: 'osmosis',
      keepMessageColors: true, specialHtml: true, glassButtons: true, autoScroll: false, showProgress: true,
      showInModeControls: true, mobilePerformance: 'off',
      // Every effect on, so each one can be checked; the shipped defaults are the Balanced preset.
      lightSweep: true, inkSettle: true, breathing: true, dialogueWarmth: true, edgeTrace: true,
      finishRing: true, dawnGlow: true, depthSway: true, trailingLines: true, focusVignette: true,
    });

    // 1. Colors: dark colors lifted to readable, hue kept, multi-beat run keeps color in each beat.
    await api('debugOpenHtml', COLOR_HTML, 'Ines');
    await page.waitForTimeout(400);
    let s = await state();
    const colorBeats = s.beatHtml.filter(h => /im-color/.test(h));
    check(`${tag}: colored runs survive splitting`, colorBeats.length >= 4, `${colorBeats.length} colored beats of ${s.beats.length}`);
    const redBeats = s.beatHtml.filter(h => /dark red|stay red/.test(h));
    check(`${tag}: a color spanning two sentences colors both`, redBeats.length === 2 && redBeats.every(h => /im-color/.test(h)), JSON.stringify(redBeats));
    const lum = await page.evaluate(html => {
      const m = html.match(/color:rgb\((\d+), (\d+), (\d+)\)/);
      if (!m) return null;
      const ch = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      const L = 0.2126 * ch(+m[1]) + 0.7152 * ch(+m[2]) + 0.0722 * ch(+m[3]);
      const bg = 0.2126 * ch(16) + 0.7152 * ch(18) + 0.0722 * ch(24);
      return { rgb: m.slice(1, 4).map(Number), ratio: (L + 0.05) / (bg + 0.05) };
    }, s.beatHtml.find(h => /navy/.test(h)) || '');
    check(`${tag}: navy text lifted to readable contrast`, lum && lum.ratio >= 4.4 && lum.rgb[2] > lum.rgb[0], JSON.stringify(lum));
    await page.screenshot({ path: `${SHOTS}/${tag}-colors.png` });

    // 1b. Colors under every text material stay visible (gradient materials must not hide them).
    for (const material of ['pearl', 'crystal', 'liquid', 'etched']) {
      await api('debugSetSettings', { material });
      await api('debugOpenHtml', '<p><font color="#ff6666">Colored words here.</font></p>', 'Ines');
      await page.waitForTimeout(250);
      const fillOk = await shadow(`(r) => { const el = r.querySelector('.layer .txt .im-color'); if (!el) return 'missing'; const cs = getComputedStyle(el); return cs.webkitTextFillColor === cs.color ? 'ok' : cs.webkitTextFillColor; }`);
      check(`${tag}: color visible under ${material}`, fillOk === 'ok', fillOk);
    }
    await api('debugSetSettings', { material: 'etched' });

    // 1c. A plain wrapper <div> around colored prose stays prose (split into lines), not a card;
    // dark colors inside a real card are lightened too.
    await api('debugOpenHtml', '<div><font color="#1a1a6e">"Hello there." She waved. "Come in."</font></div><div style="border:1px solid #888;padding:6px"><span style="color:#202060">Card text.</span></div>', 'Ines');
    await page.waitForTimeout(300);
    s = await state();
    const proseLines = s.beatHtml.filter(h => !/border/.test(h));
    const cardHtml = s.beatHtml.find(h => /border/.test(h)) || '';
    check(`${tag}: wrapper div around prose is split into lines`, proseLines.length >= 3, `${proseLines.length} prose beats`);
    check(`${tag}: dark color inside a card is lightened`, /color:\s*rgb\(/.test(cardHtml) && !/#202060/i.test(cardHtml), cardHtml.slice(0, 200));

    // 1d. Mixed quote styles (“ … " as models often write) close per line and never swallow the
    // rest of the message into one giant beat. Every word is kept.
    const nested = await api('debugSegmentHtml', '<p>He reached for his glass. "Right then, a “game” of truth?" She smiled. "He said "no" to me." Done.</p>');
    check(`${tag}: a quote inside a quote stays one line`, nested.includes('"Right then, a “game” of truth?"') && nested.includes('"He said "no" to me."'), JSON.stringify(nested));
    const mixedB = await api('debugSegmentHtml', '<p>"Hello,” she said. "How are you?"</p>');
    check(`${tag}: straight-open curly-close quote closes at its own end`, mixedB.length === 3 && mixedB[1].trim() === 'she said.', JSON.stringify(mixedB));
    const mixed = '<p><em>Dave raised an eyebrow.</em> “You\'ve spent all day pretending."</p><p><em>Tony grinned.</em> “Fair point."</p><p><em>He reached for his glass.</em> <q>"Right then, a game?"</q></p><p>"OK Eloise, truth or dare?”</p>';
    const mixedBeats = await api('debugSegmentHtml', mixed);
    const words = t => t.replace(/[^A-Za-z']+/g, ' ').trim().split(/\s+/);
    const allWords = words(await page.evaluate(h => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent; }, mixed)).join(' ');
    check(`${tag}: mixed quotes split per line`, mixedBeats.length >= 7 && Math.max(...mixedBeats.map(b => b.length)) < 60, JSON.stringify(mixedBeats));
    check(`${tag}: mixed quotes keep every word`, words(mixedBeats.join(' ')).join(' ') === allWords, words(mixedBeats.join(' ')).join(' '));

    // 1e. The buttons and the progress rail never overlap.
    await api('debugOpenHtml', '<p>One. Two. Three.</p>', 'Ines');
    await page.waitForTimeout(300);
    for (const rail of ['osmosis', 'liquid', 'capsule', 'ticks', 'line']) {
      await api('debugSetSettings', { railStyle: rail });
      await page.waitForTimeout(120);
      const gap = await shadow(`(r) => { const c = r.querySelector('.controls').getBoundingClientRect(); const h = r.querySelector('.railbox').getBoundingClientRect(); return h.top - c.bottom; }`);
      check(`${tag}: ${rail} rail sits below the buttons`, gap >= 4, `gap=${gap}`);
    }
    await api('debugSetSettings', { railStyle: 'osmosis' });

    // 1f. Ambient progress and light sweep follow reading: the edge trace and dawn advance with
    // progress, the sweep plays once when landing on a line, and each switch turns its effect off.
    await api('debugSetSettings', { edgeTrace: true, dawnGlow: true, lightSweep: true });
    await api('debugOpenHtml', '<p>One line here. Two lines here. Three lines here. Four lines here.</p>', 'Ines');
    await page.waitForTimeout(900);
    const ambientAt = () => shadow(`(r) => ({
      dash: Number(r.querySelector('.trace-line').style.strokeDashoffset),
      len: r.querySelector('.trace-line').getTotalLength(),
      warm: Number(r.querySelector('.dawn .warm').style.opacity || 0),
      trace: getComputedStyle(r.querySelector('.trace')).opacity,
      dawn: getComputedStyle(r.querySelector('.dawn')).opacity,
    })`);
    const a0 = await ambientAt();
    await page.keyboard.press('ArrowDown');
    // The sweep starts when the line has finished arriving (about half a second, longer on a
    // loaded machine) and lasts 0.9 s, so poll for it.
    let sweeping = false;
    for (let i = 0; i < 20 && !sweeping; i++) { await page.waitForTimeout(80); sweeping = await shadow(`(r) => [...r.querySelectorAll('.layer .sweep')].some(el => el.getAnimations().length > 0)`); }
    // Edge trace and dawn drift on a spring; poll until they have moved (slow machines take longer).
    let a1 = await ambientAt();
    for (let i = 0; i < 40 && !(a0.dash > a1.dash + 20 && a1.warm > a0.warm + 0.2); i++) { await page.waitForTimeout(100); a1 = await ambientAt(); }
    check(`${tag}: edge trace advances with reading`, a0.dash > a1.dash + 20 && a0.dash >= a0.len * 0.95, JSON.stringify({ a0, a1 }));
    check(`${tag}: dawn warms with reading`, a1.warm > a0.warm + 0.2, JSON.stringify({ before: a0.warm, after: a1.warm }));
    check(`${tag}: light sweep plays when landing on a line`, sweeping, `animating=${sweeping}`);
    // Breathing starts after resting on a line; dialogue warmth follows spoken lines.
    await page.waitForTimeout(2600);
    const breathing = await shadow(`(r) => [...r.querySelectorAll('.layer .glow')].some(el => el.getAnimations().some(a => a.effect?.getTiming?.().iterations === Infinity))`);
    check(`${tag}: breathing starts after resting on a line`, breathing, `breathing=${breathing}`);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
    const stopped = await shadow(`(r) => ![...r.querySelectorAll('.layer .glow')].some(el => el.getAnimations().some(a => a.effect?.getTiming?.().iterations === Infinity))`);
    check(`${tag}: breathing stops when you move`, stopped, `stopped=${stopped}`);
    await api('debugOpenHtml', '<p>She looked up. "Hello there," she said.</p>', 'Ines');
    await page.waitForTimeout(500);
    const moodNarration = await shadow(`(r) => r.querySelector('.mood').style.opacity`);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(700);
    const moodDialogue = await shadow(`(r) => r.querySelector('.mood').style.opacity`);
    check(`${tag}: dialogue warmth follows spoken lines`, moodNarration !== '1' && moodDialogue === '1', `narration=${moodNarration} dialogue=${moodDialogue}`);
    // Finish ring plays once when the last line has settled.
    await page.keyboard.press('ArrowDown');
    let ring = false;
    for (let i = 0; i < 15 && !ring; i++) { await page.waitForTimeout(100); ring = await shadow(`(r) => [...r.querySelectorAll('.trace-line')].some(el => el.getAnimations().length > 0)`); }
    check(`${tag}: finish ring glows on the last line`, ring, `ring=${ring}`);
    await api('debugSetSettings', { edgeTrace: false, dawnGlow: false, lightSweep: false });
    let off;
    for (let i = 0; i < 20; i++) { await page.waitForTimeout(150); off = await ambientAt(); if (Number(off.trace) < 0.01 && Number(off.dawn) < 0.01) break; }
    check(`${tag}: edge trace and dawn switch off`, Number(off.trace) < 0.01 && Number(off.dawn) < 0.01, JSON.stringify(off));
    await api('debugSetSettings', { edgeTrace: true, dawnGlow: true, lightSweep: true });

    // 2. Scrolling: wheel glide moves freely and rests between lines (free mode unchanged).
    const box = await stageBox();
    await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
    if (!viewport.mobile) {
      for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 90); await page.waitForTimeout(16); }
      await page.waitForTimeout(1200);
      s = await state();
      check(`${tag}: wheel glide moves forward`, s.visual > 0.3, `visual=${s.visual.toFixed(3)}`);
      await api('debugOpenHtml', LONG_HTML, 'Ines');
      await page.waitForTimeout(400);
      await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
      let vig = 0;
      let sway = 0;
      for (let i = 0; i < 6; i++) {
        await page.mouse.wheel(0, 220);
        await page.waitForTimeout(16);
        const m = await shadow(`(r) => ({ v: Number(r.querySelector('.vignette').style.opacity || 0), t: r.querySelector('.ambient').style.transform })`);
        vig = Math.max(vig, m.v);
        const ty = Number((m.t.match(/translate3d\(0px?, (-?[\d.]+)px/) || [0, 0])[1]);
        sway = Math.max(sway, Math.abs(ty));
      }
      check(`${tag}: focus vignette darkens while scrolling fast`, vig > 0.2, `vignette=${vig}`);
      check(`${tag}: depth sway leans the background with the scroll`, sway > 3, `sway=${sway}px`);
      // Wait for the glide to finish completely (a strong wheel glide runs for a few seconds).
      let rest;
      for (let i = 0; i < 150; i++) {
        await page.waitForTimeout(150);
        rest = await shadow(`(r) => ({ v: r.querySelector('.vignette').style.opacity, t: r.querySelector('.ambient').style.transform })`);
        if (!(await state()).fxRunning && Number(rest.v || 0) === 0) break;
      }
      rest = await shadow(`(r) => ({ v: r.querySelector('.vignette').style.opacity, t: r.querySelector('.ambient').style.transform })`);
      check(`${tag}: vignette and sway settle back at rest`, Number(rest.v || 0) === 0 && (rest.t === '' || /translate3d\(0px?, -?0(\.0)?px/.test(rest.t)), JSON.stringify(rest));
    }

    // 3. Layer reuse: scrolling within view does not rebuild text.
    const nodesBefore = await shadow('(r) => [...r.querySelectorAll(".layer .txt")].map(n => n.dataset.k || (n.dataset.k = Math.random().toString(36).slice(2))).join(",")');
    await page.evaluate(() => {
      const st = globalThis.SillyTavernImmersiveMode.getState();
      return st.visual;
    });
    await shadow('(r) => { r.querySelector(".stage").dispatchEvent(new WheelEvent("wheel", { deltaY: 6, bubbles: true, cancelable: true })); }');
    await page.waitForTimeout(300);
    const nodesAfter = await shadow('(r) => [...r.querySelectorAll(".layer .txt")].map(n => n.dataset.k || "new").join(",")');
    const kept = nodesBefore.split(',').filter(k => nodesAfter.split(',').includes(k)).length;
    check(`${tag}: small scrolls reuse line elements`, kept >= Math.max(1, nodesBefore.split(',').length - 1), `${kept}/${nodesBefore.split(',').length} kept`);

    // 4. Edge bounce + exit, same rule as before the bounce existed: the push that reaches the
    // last line only arrives (and bounces); the next push closes. Waits outlast the 430 ms fade.
    await dismissPopups();
    const start = await page.evaluate(() => {
      const host = [...document.body.children].find(el => el.shadowRoot && el.shadowRoot.querySelector('.stage'));
      for (let y = innerHeight * 0.85; y > innerHeight * 0.3; y -= 12) {
        for (const x of [innerWidth / 2, innerWidth * 0.1, innerWidth * 0.9]) {
          if (document.elementFromPoint(x, y) === host && document.elementFromPoint(x, y - 140) !== null) return { x, y };
        }
      }
      return { x: innerWidth / 2, y: innerHeight / 2 };
    });
    const drag = async (pixels) => {
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      const steps = 8;
      for (let i = 1; i <= steps; i++) { await page.mouse.move(start.x, start.y - (pixels * i) / steps); await page.waitForTimeout(16); }
      const glow = await shadow('(r) => Number(r.querySelector(".edge.bottom").style.opacity || 0)');
      await page.mouse.up();
      return glow;
    };
    await api('debugOpenHtml', '<p>One line here. Two lines here. Three lines here.</p>', 'Ines');
    await page.waitForTimeout(400);
    // Slow drag from the first line far past the last: it reaches the end and stretches.
    const glowMid = await drag(Math.min(560, start.y - 40));
    await page.waitForTimeout(700);
    s = await state();
    check(`${tag}: the drag that reaches the end bounces and stays open`, s.open && glowMid > 0.2 && Math.round(s.visual) === s.beats.length - 1, `open=${s.open} glow=${glowMid} visual=${s.visual}`);
    // Next push, sent while the bounce is still settling: closes.
    await drag(120);
    await page.waitForTimeout(700);
    s = await state();
    check(`${tag}: the next push closes, even mid-bounce`, !s.open, `open=${s.open}`);

    // 4a. A push at the first line lights only the top bar, never the bottom one.
    if (!viewport.mobile) {
      await api('debugOpenHtml', '<p>One line here. Two lines here. Three lines here.</p>', 'Ines');
      await page.waitForTimeout(500);
      await page.mouse.move(start.x, start.y);
      await page.mouse.wheel(0, -150);
      let top = 0;
      let bottom = 0;
      for (let i = 0; i < 50; i++) {
        await page.waitForTimeout(16);
        const g = await shadow('(r) => [Number(r.querySelector(".edge.top").style.opacity || 0), Number(r.querySelector(".edge.bottom").style.opacity || 0)]');
        top = Math.max(top, g[0]); bottom = Math.max(bottom, g[1]);
      }
      check(`${tag}: top bounce lights only the top edge`, top > 0.5 && bottom === 0, `top=${top} bottom=${bottom}`);
    }

    // 4a2. Edge styles and frosted background apply, and performance mode drops the frosted blur.
    if (!viewport.mobile) {
      for (const edgeStyle of ['rim', 'glow']) {
        await api('debugSetSettings', { edgeStyle });
        const cls = await shadow('(r, h) => [...h.classList].filter(c => c.startsWith("edge-")).join(",")');
        check(`${tag}: edge style ${edgeStyle} applies`, cls === `edge-${edgeStyle}`, cls);
      }
      await api('debugSetSettings', { edgeStyle: 'rim', backdrop: 'frosted', mobilePerformance: 'off' });
      await page.waitForTimeout(400);
      const frosted = await page.evaluate(() => document.body.classList.contains('im-backdrop-frosted') && getComputedStyle(document.getElementById('sheld')).filter);
      await api('debugSetSettings', { mobilePerformance: 'on' });
      const perf = await page.evaluate(() => document.body.classList.contains('im-backdrop-frosted'));
      await api('debugSetSettings', { mobilePerformance: 'off', backdrop: 'dim' });
      const dim = await page.evaluate(() => document.body.classList.contains('im-backdrop-frosted'));
      await api('debugSetSettings', { backdrop: 'frosted' });
      check(`${tag}: frosted background blurs the page`, typeof frosted === 'string' && /blur\(18px\)/.test(frosted), String(frosted));
      check(`${tag}: performance mode and Dim only drop the blur`, perf === false && dim === false, `perf=${perf} dim=${dim}`);
    }

    // 4b. A wheel push at the last line makes the stack visibly overshoot (in lines) and spring back.
    if (!viewport.mobile) {
      await api('debugOpenHtml', '<p>One line here. Two lines here. Three lines here.</p>', 'Ines');
      await page.waitForTimeout(400);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(1000);
      await page.mouse.move(start.x, start.y);
      await page.mouse.wheel(0, 120);
      let peak = 0;
      for (let i = 0; i < 12; i++) { await page.waitForTimeout(30); peak = Math.max(peak, (await state()).overscroll); }
      check(`${tag}: the bounce visibly overshoots`, peak >= 0.25, `peak=${peak.toFixed(2)} lines`);
      // About half a second at 60 fps; the headless browser can run slower, so allow up to 2.5 s.
      let back = 1;
      for (let i = 0; i < 50; i++) { await page.waitForTimeout(100); back = (await state()).overscroll; if (back === 0) break; }
      check(`${tag}: the bounce springs back to rest`, back === 0, `overscroll=${back}`);
    }

    // 5. Keyboard: the press that lands on the last line arrives; the next press closes.
    await api('debugOpenHtml', '<p>One line here. Two lines here. Three lines here.</p>', 'Ines');
    await page.waitForTimeout(400);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    const atEnd = await settle();
    await page.keyboard.press('ArrowDown');
    let afterPush = await state();
    for (let i = 0; i < 30 && afterPush.open; i++) { await page.waitForTimeout(100); afterPush = await state(); }
    check(`${tag}: quick key presses all count and reach the end`, atEnd.open && Math.round(atEnd.visual) === 2, `visual=${atEnd.visual}`);
    check(`${tag}: one more key press at the end closes`, !afterPush.open, `open=${afterPush.open}`);

    // 6. HTML card: rendered live, stays inside the safe area at Bottom position, scrolls inside itself.
    await api('debugOpenHtml', CARD_HTML, 'Narrator');
    await page.waitForTimeout(300);
    s = await state();
    const cardIndex = s.beatHtml.findIndex(h => /status-card/.test(h));
    check(`${tag}: HTML block becomes a live card`, cardIndex >= 0, `index=${cardIndex}`);
    for (let i = 0; i < cardIndex; i++) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(40); }
    await page.waitForTimeout(800);
    const fit = await shadow(`(r) => {
      const stage = r.querySelector('.stage').getBoundingClientRect();
      const card = [...r.querySelectorAll('.layer.html-card')].find(l => l.style.visibility !== 'hidden' && Number(l.style.opacity) > 0.9);
      const controls = r.querySelector('.controls').getBoundingClientRect();
      const top = r.querySelector('.topbar').getBoundingClientRect();
      if (!card) return null;
      const b = card.getBoundingClientRect();
      return { top: b.top - stage.top, bottom: b.bottom - stage.top, stageH: stage.height, controlsTop: controls.top - stage.top, topbarBottom: top.bottom - stage.top, scrollable: card.scrollHeight > card.clientHeight, scrollTop: card.scrollTop };
    }`);
    check(`${tag}: tall card fits between the top buttons and the controls`, fit && fit.top >= fit.topbarBottom - 2 && fit.bottom <= fit.controlsTop + 2, JSON.stringify(fit));
    await page.screenshot({ path: `${SHOTS}/${tag}-card.png` });
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(250);
    const inner = await shadow(`(r) => { const card = [...r.querySelectorAll('.layer.html-card')].find(l => l.style.visibility !== 'hidden' && Number(l.style.opacity) > 0.9); return card ? card.scrollTop : -1; }`);
    s = await state();
    check(`${tag}: next key scrolls inside the tall card first`, inner > 0 && Math.round(s.visual) === cardIndex, `scrollTop=${inner} visual=${s.visual}`);

    // 7. Bottom position with long prose: the focal line stays above the controls.
    await api('debugOpenHtml', '<p>' + 'A very long single sentence that goes on and on, '.repeat(18) + 'and finally ends.</p>', 'Ines');
    await page.waitForTimeout(400);
    const prose = await shadow(`(r) => {
      const stage = r.querySelector('.stage').getBoundingClientRect();
      const layer = [...r.querySelectorAll('.layer')].find(l => Number(l.style.opacity) > 0.9);
      const controls = r.querySelector('.controls').getBoundingClientRect();
      const b = layer.getBoundingClientRect();
      return { top: b.top - stage.top, bottom: b.bottom - stage.top, controlsTop: controls.top - stage.top };
    }`);
    check(`${tag}: long line at Bottom stays above the controls`, prose.bottom <= prose.controlsTop + 2 && prose.top >= 0, JSON.stringify(prose));
    await page.screenshot({ path: `${SHOTS}/${tag}-bottom-long.png` });
    await api('close');
    await page.waitForTimeout(600);

    // 8. Settings drawer: every control has a value and changing one saves and applies.
    // A neighbor extension's floating window can sit over the toolbar; open the drawer directly.
    await page.locator('#extensions-settings-button .drawer-icon').dispatchEvent('click');
    await page.waitForTimeout(900);
    await page.evaluate(() => {
      const root = document.querySelector('.immersive_mode_settings');
      const header = root?.querySelector(':scope > .inline-drawer > .inline-drawer-header');
      const content = root?.querySelector(':scope > .inline-drawer > .inline-drawer-content');
      if (header && content && getComputedStyle(content).display === 'none') header.click();
    });
    await page.waitForTimeout(500);
    const drawer = await page.evaluate(() => {
      const root = document.querySelector('.immersive_mode_settings');
      if (!root) return null;
      root.querySelectorAll('.inline-drawer-content').forEach(el => { el.style.display = 'block'; });
      const inputs = [...root.querySelectorAll('input, select')];
      const blank = inputs.filter(el => el.tagName === 'SELECT' && !el.value).map(el => el.className);
      return { count: inputs.length, blank, sections: [...root.querySelectorAll('.im-section > .inline-drawer-header b')].map(b => b.textContent) };
    });
    check(`${tag}: drawer renders all sections with values`, drawer && drawer.sections.length === 6 && drawer.blank.length === 0, JSON.stringify(drawer));
    await page.evaluate(() => {
      const select = document.querySelector('.immersive_mode_settings .im_rail_style');
      select.value = 'capsule';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const railSaved = await page.evaluate(() => globalThis.SillyTavern?.getContext?.().extensionSettings?.immersiveMode?.railStyle);
    check(`${tag}: drawer change saves the setting`, railSaved === 'capsule', `railStyle=${railSaved}`);
    // Presets: picking one sets its effects and the cost meter follows; editing turns it Custom.
    const pick = async name => page.evaluate(n => { const s = document.querySelector('.immersive_mode_settings .im_preset'); s.value = n; s.dispatchEvent(new Event('change', { bubbles: true })); }, name);
    const meter = () => page.evaluate(() => ({ preset: document.querySelector('.immersive_mode_settings .im_preset').value, text: document.querySelector('.immersive_mode_settings .im_cost_text').textContent, dawn: document.querySelector('.immersive_mode_settings .im_dawn_glow').checked, rail: document.querySelector('.immersive_mode_settings .im_rail_style').value, saved: SillyTavern.getContext().extensionSettings.immersiveMode.dawnGlow }));
    await pick('full');
    const full = await meter();
    await pick('balanced');
    const balanced = await meter();
    await page.evaluate(() => { const c = document.querySelector('.immersive_mode_settings .im_dawn_glow'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
    const custom = await meter();
    await pick('balanced');
    check(`${tag}: Full preset turns its effects on`, full.preset === 'full' && full.dawn && full.saved === true && full.rail === 'osmosis', JSON.stringify(full));
    check(`${tag}: Balanced preset turns the costly ones off`, balanced.preset === 'balanced' && !balanced.dawn && balanced.saved === false && balanced.rail === 'liquid', JSON.stringify(balanced));
    check(`${tag}: cost meter shows measured numbers`, /\+120%/.test(full.text) && /\+23%/.test(balanced.text), `${full.text} | ${balanced.text}`);
    check(`${tag}: changing an effect makes it Custom with an estimate`, custom.preset === 'custom' && /~\+41%/.test(custom.text), JSON.stringify(custom));
    const tags = await page.evaluate(() => document.querySelectorAll('.immersive_mode_settings .im-cost-tag').length);
    check(`${tag}: every effect shows its cost`, tags >= 12, `tags=${tags}`);
    const snapRowHidden = await page.evaluate(() => getComputedStyle(document.querySelector('.immersive_mode_settings .im_threshold_row')).display === 'none');
    check(`${tag}: snap point only shows for snap mode`, snapRowHidden, `hidden=${snapRowHidden}`);
    const drawerEl = await page.$('.immersive_mode_settings');
    if (drawerEl) {
      await drawerEl.scrollIntoViewIfNeeded().catch(() => {});
      await drawerEl.screenshot({ path: `${SHOTS}/${tag}-drawer.png`, timeout: 8000 }).catch(e => errors.push(`${tag}: drawer screenshot: ${e.message.split('\n')[0]}`));
    }
    // Put the user-facing defaults back so STD is left at the shipped state.
    await api('debugSetSettings', { position: 'center' });

    await context.close();
  }
  // Leave STD at the shipped look: the recommended preset.
  {
    const context = await browser.newContext({ storageState: STORAGE });
    const page = await context.newPage();
    await page.goto(URL);
    await page.waitForFunction(() => !!globalThis.SillyTavernImmersiveMode, null, { timeout: 120000 });
    const { PRESETS } = await import('../src/effects.js');
    await page.evaluate(values => globalThis.SillyTavernImmersiveMode.debugSetSettings(values), { ...PRESETS.balanced.values, material: 'etched', mobilePerformance: 'auto' });
    // SillyTavern saves settings on a delay; save now so closing the page does not drop it.
    await page.evaluate(() => SillyTavern.getContext().saveSettings?.());
    await page.waitForTimeout(1500);
    await context.close();
  }
  await browser.close();
  check('no extension errors', errors.length === 0, errors.join(' | '));
  check('no model requests', modelRequests.length === 0, modelRequests.join(' | '));
  const passed = results.every(r => r.ok);
  console.log(JSON.stringify({ passed, results }, null, 2));
  process.exit(passed ? 0 : 1);
}

main().catch(error => { console.error(error); process.exit(2); });
