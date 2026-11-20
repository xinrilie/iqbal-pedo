import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('draft order total SQL explicitly types both bigint parameters', async () => {
  const source = await readFile(resolve('src/lib/order-service.js'), 'utf8');
  const matches = source.match(/grand_total_amount\s*=\s*\$2::bigint\s*\+\s*\$3::bigint/g) ?? [];
  assert.equal(matches.length, 2, 'create and replace draft must both use explicit bigint casts');
  assert.doesNotMatch(source, /grand_total_amount\s*=\s*\$2\s*\+\s*\$3(?!::)/);
});
