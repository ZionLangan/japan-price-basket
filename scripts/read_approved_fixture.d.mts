export interface LazyFixture {
  [key: string]: unknown;
  series: Readonly<Record<string, unknown>>;
}
export function parseFixtureBuffer(
  buffer: Buffer,
  options?: { maxSliceBytes?: number },
): LazyFixture;
export function readApprovedFixture(compressed: Buffer, approval: { sha256: string }): LazyFixture;
