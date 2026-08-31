import { strict as assert } from 'node:assert';
import { createIgnoreMatcher } from '../../src/ignore/ignoreMatcher';

suite('createIgnoreMatcher', () => {
  test('returns false when no patterns are configured', () => {
    const isIgnored = createIgnoreMatcher([]);

    assert.equal(isIgnored('src/index.ts'), false);
  });

  test('matches extension patterns at any depth', () => {
    const isIgnored = createIgnoreMatcher(['*.pem', '*.key']);

    assert.equal(isIgnored('server.pem'), true);
    assert.equal(isIgnored('certificates/server.key'), true);
    assert.equal(isIgnored('certificates/server.crt'), false);
  });

  test('matches directory patterns without matching similar names', () => {
    const isIgnored = createIgnoreMatcher(['config/local/']);

    assert.equal(isIgnored('config/local/settings.json'), true);
    assert.equal(isIgnored('config/locality/settings.json'), false);
  });

  test('supports negated patterns', () => {
    const isIgnored = createIgnoreMatcher(['.env*', '!.env.example']);

    assert.equal(isIgnored('.env'), true);
    assert.equal(isIgnored('packages/app/.env.local'), true);
    assert.equal(isIgnored('.env.example'), false);
  });

  test('supports root-anchored directory patterns', () => {
    const isIgnored = createIgnoreMatcher(['/dist/']);

    assert.equal(isIgnored('dist/index.js'), true);
    assert.equal(isIgnored('packages/app/dist/index.js'), false);
  });
});
