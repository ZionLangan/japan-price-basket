import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { parseFixtureBuffer, readApprovedFixture } from '../scripts/read_approved_fixture.mjs';

// Synthetic parser fixtures only; these are never published as source prices.
const bytes = (json: string) => Buffer.from(json, 'utf8');
const synthetic = {
  before: '日本語, braces { } [ ] and quote " and backslash \\',
  cities: [{ id: '13100' }, { id: '01100' }],
  series: {
    '13100': {
      'synthetic-rice': [{ month: '2000-01', price: '123', extra: [true, false, null, -1.2e3] }],
    },
    '01100': { 'synthetic-rice': [] },
  },
  after: { sources: ['a\\"b', '年度'] },
};

it('indexes metadata before and after series and parses escaped nested values', () => {
  const fixture = parseFixtureBuffer(bytes(JSON.stringify(synthetic)));
  expect(fixture.before).toBe(synthetic.before);
  expect(fixture.after).toEqual(synthetic.after);
  expect(Object.keys(fixture.series)).toEqual(['13100', '01100']);
  expect(fixture.series['13100']).toEqual(synthetic.series['13100']);
  expect(fixture.series['01100']).toEqual(synthetic.series['01100']);
  expect(Object.getPrototypeOf(fixture.series)).toBeNull();
});

it('keeps city data lazy and uncached so mutated results cannot alter later reads', () => {
  const fixture = parseFixtureBuffer(bytes(JSON.stringify(synthetic)));
  const descriptor = Object.getOwnPropertyDescriptor(fixture.series, '13100');
  expect(descriptor?.get).toBeTypeOf('function');
  expect(descriptor?.value).toBeUndefined();
  const first = fixture.series['13100'] as (typeof synthetic.series)['13100'];
  first['synthetic-rice'][0].price = '999';
  expect(fixture.series['13100']).toEqual(synthetic.series['13100']);
  expect(fixture.series['13100']).not.toBe(fixture.series['13100']);
  expect(Object.isFrozen(fixture.series)).toBe(true);
});

it('verifies the compressed approval before decompression', () => {
  const compressed = gzipSync(bytes(JSON.stringify(synthetic)));
  const approval = { sha256: createHash('sha256').update(compressed).digest('hex') };
  expect(readApprovedFixture(compressed, approval).cities).toEqual(synthetic.cities);
  expect(() => readApprovedFixture(compressed, { sha256: '0'.repeat(64) })).toThrow('checksum');
  expect(() => readApprovedFixture(bytes('not gzip'), approval)).toThrow('checksum');
  expect(() => readApprovedFixture(compressed, { sha256: 'not a checksum' })).toThrow('checksum');
});

it.each([
  '{"cities":[],"series":{},"series":{}}',
  '{"cities":[],"series":{},"\\u0073eries":{}}',
  '{"cities":[{"id":"13100"}],"series":{"13100":{},"13100":{}}}',
  '{"cities":[{"id":"13100"}],"series":{"13100":{"food":[],"food":[]}}}',
  '{"cities":[{"id":"13100"}],"series":{"13100":{"food":[{"price":1,"price":2}]}}}',
])('rejects duplicate keys including escaped equivalents: %s', (json) => {
  expect(() => parseFixtureBuffer(bytes(json))).toThrow('duplicate property');
});

it.each([
  '{"cities":[],"series":{}} trailing',
  '{"cities":[],"series":{',
  '{"cities":[],"series":{},}',
  '{"cities":[],"series":[],"extra":1}',
  '{"cities":[],"series":{},"extra":01}',
  '{"cities":[],"series":{},"extra":1.}',
  '{"cities":[],"series":{},"extra":1e}',
  '{"cities":[],"series":{},"extra":truefalse}',
  '{"cities":[],"series":{},"extra":"\\q"}',
  '{"cities":[],"series":{},"extra":"\\uGGGG"}',
  '{"cities":[],"series":{},"extra":"unterminated}',
  '{"cities":[],"series":{},"extra":[1,]}',
  '{"cities":[],"series":{},"extra":[1}}',
  '{"cities":[{"id":"13100"}],"series":{"13100":[]}}',
])('rejects malformed JSON boundaries and values: %s', (json) => {
  expect(() => parseFixtureBuffer(bytes(json))).toThrow();
});

it.each([
  '{"cities":[]}',
  '{"series":{}}',
  '{"cities":[{"id":"13100"}],"series":{}}',
  '{"cities":[],"series":{"13100":{}}}',
  '{"cities":[{"id":"13100"},{"id":"13100"}],"series":{"13100":{}}}',
  '{"cities":[{"id":123}],"series":{"123":{}}}',
])('requires one matching series for each unique city: %s', (json) => {
  expect(() => parseFixtureBuffer(bytes(json))).toThrow();
});

it('rejects invalid UTF-8, excessive nesting and city slices before string allocation', () => {
  expect(() => parseFixtureBuffer(Buffer.from([123, 34, 255, 34, 58, 48, 125]))).toThrow('UTF-8');
  const deep = `{"cities":[],"series":{},"extra":${'['.repeat(130)}0${']'.repeat(130)}}`;
  expect(() => parseFixtureBuffer(bytes(deep))).toThrow('nesting limit');
  const largeCity = JSON.stringify({
    cities: [{ id: '13100' }],
    series: { '13100': { value: 'x'.repeat(200) } },
  });
  expect(() => parseFixtureBuffer(bytes(largeCity), { maxSliceBytes: 100 })).toThrow('City 13100');
  expect(() => parseFixtureBuffer(bytes('{}'), { maxSliceBytes: 0 })).toThrow('slice limit');
});
