// Test runner: discovers compiled test files under **/dist/test and runs them
// with node's built-in test runner using the spec reporter.
import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { glob } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const pattern = '**/dist/test/**/*.test.js';
const files = [];
for await (const entry of glob(pattern, { cwd: root })) {
  files.push(resolve(root, entry));
}

if (files.length === 0) {
  console.error('No test files found matching', pattern);
  process.exit(1);
}

const stream = run({ files });
stream.compose(spec).pipe(process.stdout);

let failed = 0;
stream.on('test:fail', () => {
  failed++;
});
stream.on('end', () => {
  process.exit(failed > 0 ? 1 : 0);
});
