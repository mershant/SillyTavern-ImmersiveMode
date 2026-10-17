import assert from 'node:assert/strict';
import test from 'node:test';

import { contrast, parseRgb, readableColor, READER_BACKGROUND, MIN_CONTRAST } from '../src/color.js';
import { balanceMarkers } from '../src/markers.js';


test('keeps colors that are already readable on the reader background', () => {
  assert.equal(readableColor('rgb(255, 207, 107)'), 'rgb(255, 207, 107)');
  assert.equal(readableColor('#8FAE7B'), 'rgb(143, 174, 123)');
});


test('lightens dark colors until they are readable, keeping the hue', () => {
  for (const dark of ['rgb(20, 40, 120)', '#550000', 'rgb(0, 0, 0)', '#123']) {
    const out = parseRgb(readableColor(dark));
    assert.ok(contrast(out, READER_BACKGROUND) >= MIN_CONTRAST - 0.05, `${dark} -> ${JSON.stringify(out)}`);
  }
  const red = parseRgb(readableColor('#550000'));
  assert.ok(red.r > red.g && red.r > red.b, 'dark red stays red');
});


test('ignores missing and fully transparent colors', () => {
  assert.equal(readableColor(''), null);
  assert.equal(readableColor('rgba(0, 0, 0, 0)'), null);
  assert.equal(readableColor('not a color'), null);
});


test('a colored run split across beats keeps its color in every beat', () => {
  const beats = balanceMarkers(['@@IM_OPEN_0@@First sentence.', 'Second sentence.@@IM_CLOSE_0@@', 'Plain.']);
  assert.deepEqual(beats, [
    '@@IM_OPEN_0@@First sentence.@@IM_CLOSE_0@@',
    '@@IM_OPEN_0@@Second sentence.@@IM_CLOSE_0@@',
    'Plain.',
  ]);
});


test('nested runs reopen in order and close in reverse', () => {
  const beats = balanceMarkers(['@@IM_OPEN_1@@a @@IM_OPEN_0@@b.', 'c.@@IM_CLOSE_0@@ d@@IM_CLOSE_1@@']);
  assert.equal(beats[0], '@@IM_OPEN_1@@a @@IM_OPEN_0@@b.@@IM_CLOSE_0@@@@IM_CLOSE_1@@');
  assert.equal(beats[1], '@@IM_OPEN_1@@@@IM_OPEN_0@@c.@@IM_CLOSE_0@@ d@@IM_CLOSE_1@@');
});
