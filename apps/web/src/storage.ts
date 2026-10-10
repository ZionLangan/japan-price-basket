import { z } from 'zod';
import Decimal from 'decimal.js';
import {
  BasketSchema,
  Month,
  validateBasket,
  type Basket,
  type Release,
} from '../../../packages/domain/src/contracts';
import { createDefaultBasket, isLegacyDefault } from '../../../packages/domain/src/defaultBasket';

const KEY = 'japan-basket-prices:v1';
const ReleaseNoticeSchema = z
  .object({
    fromReleaseId: z.string().min(1).max(128),
    toReleaseId: z.string().min(1).max(128),
    previousEnd: Month.optional(),
    nextEnd: Month,
    advancedLatest: z.boolean(),
  })
  .strict();
export type ReleaseNotice = z.infer<typeof ReleaseNoticeSchema>;
const StateSchema = z
  .object({
    schemaVersion: z.literal(1),
    releaseId: z.string(),
    locale: z.enum(['en', 'ja']),
    observedOnly: z.boolean(),
    endMode: z.enum(['latest', 'fixed']).optional(),
    releaseEnd: Month.optional(),
    pendingReleaseNotice: ReleaseNoticeSchema.optional(),
    current: BasketSchema,
    saved: z.array(BasketSchema).max(10),
  })
  .strict();
export type StoredState = z.infer<typeof StateSchema>;
export const retiredDetergentIds = new Set([
  'dishwashing-liquid',
  'dishwashing-liquid-bottle',
  'dishwashing-liquid-per-litre',
  'liquid-laundry-detergent',
  'powder-laundry-detergent',
]);
type Migration = { removedDetergents: number; convertedEggs: boolean; updatedDefault?: boolean };
export type RestoredState = StoredState & { migration?: Migration };

function migrateBasket(basket: Basket, removeDetergents: boolean) {
  if (new Set(basket.items.map((item) => item.productId)).size !== basket.items.length)
    throw new Error('storageInvalid');
  let removedDetergents = 0;
  let convertedEggs = false;
  const items: Basket['items'] = [];
  for (const original of basket.items) {
    if (removeDetergents && retiredDetergentIds.has(original.productId)) {
      removedDetergents++;
      continue;
    }
    let item = { ...original };
    if (item.productId === 'large-size-eggs') {
      if (item.unit !== 'count') throw new Error('storageInvalid');
      item.productId = 'mixed-size-eggs';
      convertedEggs = true;
    } else if (item.productId === 'eggs-by-weight') {
      if (!['kg', 'g'].includes(item.unit)) throw new Error('storageInvalid');
      item = {
        ...item,
        productId: 'mixed-size-eggs',
        quantity: new Decimal(item.quantity)
          .mul(item.unit === 'kg' ? 1000 : 1)
          .div(60)
          .toDecimalPlaces(6)
          .toString(),
        unit: 'count',
        quantityEstimated: true,
      };
      convertedEggs = true;
    }
    const existing = items.find((i) => i.productId === item.productId);
    if (existing) {
      // Only the explicitly reviewed egg migration may merge old variant rows.
      if (item.productId !== 'mixed-size-eggs' || existing.unit !== item.unit)
        throw new Error('storageInvalid');
      existing.quantity = new Decimal(existing.quantity).plus(item.quantity).toString();
      if (item.quantityEstimated) existing.quantityEstimated = true;
    } else items.push(item);
  }
  return { basket: { ...basket, items }, removedDetergents, convertedEggs };
}

export function readState(release: Release, storage: Storage): RestoredState | null {
  const text = storage.getItem(KEY);
  if (!text) return null;
  if (text.length > 128 * 1024) throw new Error('storageInvalid');
  try {
    const parsed = StateSchema.parse(JSON.parse(text));
    const previousBasketEnd = parsed.current.end;
    if (parsed.releaseId !== release.releaseId) {
      const previousEnd = parsed.pendingReleaseNotice
        ? parsed.pendingReleaseNotice.previousEnd
        : parsed.releaseEnd;
      parsed.pendingReleaseNotice = ReleaseNoticeSchema.parse({
        fromReleaseId: parsed.pendingReleaseNotice?.fromReleaseId ?? parsed.releaseId,
        toReleaseId: release.releaseId,
        ...(previousEnd ? { previousEnd } : {}),
        nextEnd: release.end,
        advancedLatest:
          Boolean(parsed.pendingReleaseNotice?.advancedLatest) ||
          (parsed.endMode === 'latest' && previousBasketEnd !== release.end),
      });
      parsed.releaseId = release.releaseId;
      parsed.releaseEnd = release.end;
    }
    const migrated = migrateBasket(parsed.current, true);
    parsed.current = migrated.basket;
    let convertedEggs = migrated.convertedEggs;
    parsed.saved = parsed.saved.map((basket) => {
      const saved = migrateBasket(basket, false);
      convertedEggs ||= saved.convertedEggs;
      return saved.basket;
    });
    if (parsed.endMode === 'latest') parsed.current.end = release.end;
    const updatedDefault = isLegacyDefault(parsed.current, release, parsed.observedOnly);
    if (updatedDefault) parsed.current = createDefaultBasket(release);
    validateBasket(parsed.current, release);
    parsed.saved.forEach((b) => validateBasket(b, release));
    if (new Set(parsed.saved.map((b) => b.name)).size !== parsed.saved.length)
      throw new Error('storageInvalid');
    return migrated.removedDetergents || convertedEggs || updatedDefault
      ? {
          ...parsed,
          migration: {
            removedDetergents: migrated.removedDetergents,
            convertedEggs,
            ...(updatedDefault ? { updatedDefault: true } : {}),
          },
        }
      : parsed;
  } catch {
    throw new Error('storageInvalid');
  }
}
export function writeState(state: StoredState, storage: Storage) {
  storage.setItem(KEY, JSON.stringify(StateSchema.parse(state)));
}
export function acknowledgeReleaseNotice(state: StoredState): StoredState {
  const { pendingReleaseNotice: _notice, ...acknowledged } = state;
  return acknowledged;
}
export function parseImport(text: string, release: Release): Basket {
  if (new TextEncoder().encode(text).length > 64 * 1024) throw new Error('invalidBasket');
  return validateBasket(JSON.parse(text), release);
}
