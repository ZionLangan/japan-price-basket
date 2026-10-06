import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import {
  ReleaseSchema,
  CityDataSchema,
  type Release,
  type CityData,
} from '../packages/domain/src/contracts';

// Official, reviewed fixture. Synthetic edge cases are created explicitly in
// domain.test.ts and never copied into the published application dataset.
const raw = readFileSync('data/fixtures/recent-approved.json.gz');
const approval = JSON.parse(readFileSync('data/fixtures/recent-approved.manifest.json', 'utf8'));
if (createHash('sha256').update(raw).digest('hex') !== approval.sha256)
  throw new Error('Fixture hash failed');
export const fixture = JSON.parse(gunzipSync(raw).toString('utf8'));
export const release: Release = ReleaseSchema.parse({
  ...fixture,
  releaseId: 'test-official-fixture',
  cities: fixture.cities.map((c: { id: string }) => ({
    ...c,
    file: `cities/${c.id}.json`,
    sha256: 'a'.repeat(64),
  })),
});
export const city = (id = '13100'): CityData =>
  CityDataSchema.parse({
    schemaVersion: 1,
    releaseId: release.releaseId,
    cityId: id,
    scopeId: id,
    series: fixture.series[id],
  });
