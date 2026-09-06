import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareExtensionPackage } from '../scripts/verify-extension-package.js';

describe('compareExtensionPackage', () => {
  it('accepts a package directory matching extension source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'extension-package-'));
    const source = join(root, 'source');
    const extracted = join(root, 'extracted');
    await mkdir(join(source, 'nested'), { recursive: true });
    await mkdir(join(extracted, 'nested'), { recursive: true });
    await writeFile(join(source, 'manifest.json'), '{}');
    await writeFile(join(source, 'nested', 'worker.js'), 'self.ok = true;');
    await writeFile(join(extracted, 'manifest.json'), '{}');
    await writeFile(join(extracted, 'nested', 'worker.js'), 'self.ok = true;');

    assert.deepEqual(await compareExtensionPackage(source, extracted), []);
  });

  it('reports changed package files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'extension-package-'));
    const source = join(root, 'source');
    const extracted = join(root, 'extracted');
    await mkdir(source, { recursive: true });
    await mkdir(extracted, { recursive: true });
    await writeFile(join(source, 'manifest.json'), '{}');
    await writeFile(join(source, 'background.js'), 'current');
    await writeFile(join(extracted, 'manifest.json'), '{}');
    await writeFile(join(extracted, 'background.js'), 'stale');

    assert.deepEqual(await compareExtensionPackage(source, extracted), [
      'changed: background.js',
    ]);
  });
});
