import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile: 'dist/cli.js',
  minify: false,
  // The injected page probe (probe.js) is embedded as a string constant so the
  // installed CLI never needs to resolve a file path at runtime.
  loader: { '.js': 'text' },
  // node_modules stay external (ws is a runtime dep); loader only affects src/*.js.
  packages: 'external',
  banner: { js: '#!/usr/bin/env node' },
  define: { __VERSION__: JSON.stringify(pkg.version) },
});

console.log('built dist/cli.js');
