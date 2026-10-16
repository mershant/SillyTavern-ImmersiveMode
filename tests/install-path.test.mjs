import assert from 'node:assert/strict';
import test from 'node:test';

import { extensionNameFromModuleUrl } from '../src/install-path.js';


test('uses the actual GitHub repository folder when loading templates', () => {
  assert.equal(
    extensionNameFromModuleUrl(
      'https://example.test/scripts/extensions/third-party/SillyTavern-ImmersiveMode/index.js',
    ),
    'third-party/SillyTavern-ImmersiveMode',
  );
});


test('continues to work when the installed extension folder is renamed', () => {
  assert.equal(
    extensionNameFromModuleUrl(
      'https://example.test/scripts/extensions/third-party/Foreign%20Name/index.js',
    ),
    'third-party/Foreign Name',
  );
});
