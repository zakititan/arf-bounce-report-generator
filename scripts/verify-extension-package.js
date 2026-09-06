import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

async function listFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(current, entry.name);
    const relPath = relative(root, fullPath).replaceAll('\\', '/');
    if (entry.isDirectory()) {
      if (relPath !== 'releases') files.push(...await listFiles(root, fullPath));
    } else if (entry.isFile()) {
      files.push(relPath);
    }
  }
  return files;
}

export async function compareExtensionPackage(sourceDir, packageDir) {
  const sourceFiles = await listFiles(sourceDir);
  const packageFiles = await listFiles(packageDir);
  const differences = [];
  const sourceSet = new Set(sourceFiles);
  const packageSet = new Set(packageFiles);

  for (const file of sourceFiles) {
    if (!packageSet.has(file)) {
      differences.push(`missing: ${file}`);
      continue;
    }
    const [source, packaged] = await Promise.all([
      readFile(join(sourceDir, file)),
      readFile(join(packageDir, file)),
    ]);
    if (!source.equals(packaged)) differences.push(`changed: ${file}`);
  }
  for (const file of packageFiles) {
    if (!sourceSet.has(file)) differences.push(`unexpected: ${file}`);
  }
  return differences.sort();
}

async function verifyZip() {
  const projectDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const sourceDir = join(projectDir, 'extension');
  const zipPath = join(sourceDir, 'releases', 'extension.zip');
  const extractedDir = mkdtempSync(join(tmpdir(), 'extension-verify-'));
  const quote = value => `'${value.replaceAll("'", "''")}'`;

  try {
    execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath ${quote(zipPath)} -DestinationPath ${quote(extractedDir)} -Force`,
    ], { stdio: 'inherit' });
    const differences = await compareExtensionPackage(sourceDir, extractedDir);
    if (differences.length) {
      console.error('Extension package is stale or incomplete:');
      differences.forEach(difference => console.error(`- ${difference}`));
      process.exitCode = 1;
      return;
    }
    console.log('Extension package matches extension source.');
  } finally {
    rmSync(extractedDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await verifyZip();
}
