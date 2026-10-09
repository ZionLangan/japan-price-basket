// Offline fixture reader. Keep the large archive as bytes and materialize one
// city at a time; a single JSON string exceeds Node's limit for the full catalog.
import { constants, isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const decoder = new TextDecoder('utf-8', { fatal: true });
const whitespace = (byte) => byte === 32 || byte === 9 || byte === 10 || byte === 13;
const digit = (byte) => byte >= 48 && byte <= 57;
const hex = (byte) => digit(byte) || (byte >= 65 && byte <= 70) || (byte >= 97 && byte <= 102);

/** Index valid JSON without converting the whole Buffer into a string. */
export function parseFixtureBuffer(buffer, { maxSliceBytes = constants.MAX_STRING_LENGTH } = {}) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('Fixture must be a Buffer');
  if (!isUtf8(buffer)) throw new Error('Invalid fixture UTF-8');
  if (
    !Number.isSafeInteger(maxSliceBytes) ||
    maxSliceBytes < 1 ||
    maxSliceBytes > constants.MAX_STRING_LENGTH
  )
    throw new Error('Invalid JSON slice limit');
  let cursor = 0;
  const keyCache = new Map();
  const fail = (message) => {
    throw new Error(`Invalid fixture JSON at byte ${cursor}: ${message}`);
  };
  const space = () => {
    while (whitespace(buffer[cursor])) cursor++;
  };
  const slice = (start, end) => {
    if (end - start > maxSliceBytes)
      throw new Error('Fixture JSON slice exceeds Node string limit');
    return JSON.parse(decoder.decode(buffer.subarray(start, end)));
  };
  const string = () => {
    const start = cursor;
    if (buffer[cursor++] !== 34) fail('expected string');
    while (cursor < buffer.length) {
      const byte = buffer[cursor++];
      if (byte === 34) return [start, cursor];
      if (byte < 32) fail('unescaped control character');
      if (byte === 92) {
        const escape = buffer[cursor++];
        if (escape === 117) {
          for (let count = 0; count < 4; count++)
            if (!hex(buffer[cursor++])) fail('invalid Unicode escape');
        } else if (![34, 92, 47, 98, 102, 110, 114, 116].includes(escape))
          fail('invalid string escape');
      }
    }
    fail('unterminated string');
  };
  const key = () => {
    const [start, end] = string();
    const encoded = buffer.toString('utf8', start, end);
    let decoded = keyCache.get(encoded);
    if (decoded === undefined) {
      decoded = slice(start, end);
      // Property names repeat millions of times. This bounded cache interns
      // names only, and never retains observations or decoded city objects.
      if (keyCache.size < 4096) keyCache.set(encoded, decoded);
    }
    return decoded;
  };
  const object = (depth, specialValue, onEntry) => {
    if (depth > 128) fail('nesting limit exceeded');
    if (buffer[cursor++] !== 123) fail('expected object');
    const keys = new Set();
    space();
    if (buffer[cursor] === 125) {
      cursor++;
      return;
    }
    while (true) {
      const name = key();
      if (keys.has(name)) fail(`duplicate property ${name}`);
      keys.add(name);
      space();
      if (buffer[cursor++] !== 58) fail('expected colon');
      space();
      const start = cursor;
      if (!specialValue || !specialValue(name, depth + 1)) value(depth + 1);
      if (onEntry) onEntry(name, start, cursor);
      space();
      const next = buffer[cursor++];
      if (next === 125) return;
      if (next !== 44) fail('expected object comma or end');
      space();
    }
  };
  const value = (depth) => {
    if (depth > 128) fail('nesting limit exceeded');
    const byte = buffer[cursor];
    if (byte === 123) return object(depth);
    if (byte === 91) {
      cursor++;
      space();
      if (buffer[cursor] === 93) {
        cursor++;
        return;
      }
      while (true) {
        value(depth + 1);
        space();
        const next = buffer[cursor++];
        if (next === 93) return;
        if (next !== 44) fail('expected array comma or end');
        space();
      }
    }
    if (byte === 34) {
      string();
      return;
    }
    for (const literal of ['true', 'false', 'null']) {
      if (byte !== literal.charCodeAt(0)) continue;
      for (let offset = 0; offset < literal.length; offset++) {
        if (buffer[cursor++] !== literal.charCodeAt(offset)) fail('invalid literal');
      }
      return;
    }
    if (byte === 45) cursor++;
    if (buffer[cursor] === 48) cursor++;
    else {
      if (!digit(buffer[cursor]) || buffer[cursor] === 48) fail('invalid number');
      while (digit(buffer[cursor])) cursor++;
    }
    if (buffer[cursor] === 46) {
      cursor++;
      if (!digit(buffer[cursor])) fail('invalid fraction');
      while (digit(buffer[cursor])) cursor++;
    }
    if (buffer[cursor] === 69 || buffer[cursor] === 101) {
      cursor++;
      if (buffer[cursor] === 43 || buffer[cursor] === 45) cursor++;
      if (!digit(buffer[cursor])) fail('invalid exponent');
      while (digit(buffer[cursor])) cursor++;
    }
  };
  const metadata = Object.create(null);
  const cityOffsets = new Map();
  let sawSeries = false;
  space();
  object(
    0,
    (name, depth) => {
      if (name !== 'series') return false;
      sawSeries = true;
      object(depth, undefined, (cityId, start, end) => {
        if (buffer[start] !== 123) fail('city series must be an object');
        if (end - start > maxSliceBytes)
          throw new Error(`City ${cityId} exceeds Node string limit`);
        cityOffsets.set(cityId, [start, end]);
      });
      return true;
    },
    (name, start, end) => {
      if (name !== 'series') metadata[name] = slice(start, end);
    },
  );
  space();
  if (cursor !== buffer.length) fail('trailing content');
  if (!sawSeries) fail('missing series object');
  if (!Array.isArray(metadata.cities)) fail('missing city metadata');
  const cityIds = new Set();
  for (const city of metadata.cities) {
    if (!city || typeof city.id !== 'string' || cityIds.has(city.id))
      fail('invalid or duplicate city metadata');
    cityIds.add(city.id);
  }
  if (cityIds.size !== cityOffsets.size || [...cityIds].some((id) => !cityOffsets.has(id)))
    fail('city metadata and series disagree');
  const series = Object.create(null);
  for (const [cityId, [start, end]] of cityOffsets) {
    Object.defineProperty(series, cityId, {
      enumerable: true,
      get: () => slice(start, end),
    });
  }
  return Object.assign(metadata, { series: Object.freeze(series) });
}

/** Verify approval before decompressing any bytes. Never caches decoded cities. */
export function readApprovedFixture(compressed, approval) {
  if (!Buffer.isBuffer(compressed)) throw new TypeError('Compressed fixture must be a Buffer');
  if (
    !approval ||
    !/^[a-f0-9]{64}$/.test(approval.sha256 ?? '') ||
    createHash('sha256').update(compressed).digest('hex') !== approval.sha256
  )
    throw new Error('Approved fixture checksum failed');
  return parseFixtureBuffer(gunzipSync(compressed));
}
