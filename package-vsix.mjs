/**
 * package-vsix.mjs — Standalone script to package the extension as a .vsix
 * Run from anywhere: node d:\server\package-vsix.mjs
 */
import { execFileSync }  from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname   = dirname(fileURLToPath(import.meta.url));
const EXT_DIR     = resolve(__dirname, '..', 'vscode-extension');
const VSCE_CLI    = join(EXT_DIR, 'node_modules', '@vscode', 'vsce', 'vsce');

console.log('📦 Packaging CloudCost Lens extension...');
console.log('   Extension dir:', EXT_DIR);

try {
  const result = execFileSync(
    process.execPath,
    [VSCE_CLI, 'package', '--no-dependencies', '--allow-missing-repository', '--allow-star-activation'],
    { cwd: EXT_DIR, encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] },
  );
  console.log(result);
  console.log('✅ VSIX created in', EXT_DIR);
} catch (err) {
  console.error('STDOUT:\n', err.stdout);
  console.error('STDERR:\n', err.stderr);
  process.exit(1);
}
