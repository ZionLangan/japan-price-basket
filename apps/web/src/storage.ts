import { z } from 'zod';
import {
  BasketSchema,
  validateBasket,
  type Basket,
  type Release,
} from '../../../packages/domain/src/contracts';

const KEY = 'japan-basket-prices:v1';
const StateSchema = z
  .object({
    schemaVersion: z.literal(1),
    releaseId: z.string(),
    locale: z.enum(['en', 'ja']),
    observedOnly: z.boolean(),
    current: BasketSchema,
    saved: z.array(BasketSchema).max(10),
  })
  .strict();
export type StoredState = z.infer<typeof StateSchema>;
export function readState(release: Release, storage: Storage): StoredState | null {
  const text = storage.getItem(KEY);
  if (!text) return null;
  if (text.length > 128 * 1024) throw new Error('storageInvalid');
  try {
    const parsed = StateSchema.parse(JSON.parse(text));
    validateBasket(parsed.current, release);
    parsed.saved.forEach((b) => validateBasket(b, release));
    if (new Set(parsed.saved.map((b) => b.name)).size !== parsed.saved.length)
      throw new Error('storageInvalid');
    return parsed;
  } catch {
    throw new Error('storageInvalid');
  }
}
export function writeState(state: StoredState, storage: Storage) {
  storage.setItem(KEY, JSON.stringify(StateSchema.parse(state)));
}
export function parseImport(text: string, release: Release): Basket {
  if (new TextEncoder().encode(text).length > 64 * 1024) throw new Error('invalidBasket');
  return validateBasket(JSON.parse(text), release);
}
