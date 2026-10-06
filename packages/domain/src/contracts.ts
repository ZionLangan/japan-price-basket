import { z } from 'zod';

export const Month = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
export const PositiveDecimal = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/)
  .refine((v) => Number(v) > 0 && Number(v) <= 10000);
export const Unit = z.enum(['kg', 'g', 'L', 'mL', 'package', 'count', 'm', 'pair', 'cut']);
const Names = z.object({ en: z.string(), ja: z.string() });
export const ProductSchema = z.object({
  id: z.string(),
  code: z.string(),
  familyId: z.string(),
  variantId: z.string(),
  names: Names,
  aliases: z.array(z.string()),
  category: z.enum(['food', 'household']),
  unit: Unit,
  quoteQuantity: PositiveDecimal,
  quoteLabel: Names,
  units: z.array(Unit).min(1),
  presets: z.array(PositiveDecimal).min(1),
  segments: z
    .array(
      z.object({
        id: z.string(),
        start: Month,
        end: Month,
        definition: z.string(),
        detail: z.string(),
        sourceUrl: z.string().url(),
        surveyMonths: z.array(z.number().int().min(1).max(12)),
        // A break is unresolved unless the review explicitly admits continuity.
        continuityFromPrevious: z.boolean(),
      }),
    )
    .min(1),
});
export const ObservationSchema = z
  .object({
    month: Month,
    price: z
      .string()
      .regex(/^\d+(?:\.\d+)?$/)
      .nullable(),
    status: z.enum([
      'observed',
      'seasonal',
      'temporary',
      'not-surveyed',
      'unavailable',
      'local-spec',
    ]),
    segmentId: z.string(),
    sourceId: z.string(),
    raw: z.union([z.string(), z.number(), z.null()]),
    sourceRow: z.number().int().positive(),
    sourceSheet: z.string(),
    sourceUnit: z.string(),
    sourceRevision: z.string().nullable(),
  })
  .superRefine((row, ctx) => {
    if (
      (row.status === 'observed' && (row.price === null || Number(row.price) <= 0)) ||
      (row.status !== 'observed' && row.price !== null)
    )
      ctx.addIssue({ code: 'custom', message: 'Observation price and status disagree' });
  });
export const CityDataSchema = z.object({
  schemaVersion: z.literal(1),
  releaseId: z.string(),
  cityId: z.string(),
  scopeId: z.string(),
  series: z.record(z.string(), z.array(ObservationSchema)),
});
export const ReleaseSchema = z.object({
  schemaVersion: z.literal(1),
  releaseId: z.string(),
  policyVersion: z.literal('1.0'),
  start: Month,
  end: Month,
  builtAt: z.string(),
  sourceName: Names,
  cities: z.array(
    z.object({
      id: z.string(),
      names: Names,
      start: Month,
      end: Month,
      file: z.string().regex(/^cities\/\d{5}\.json$/),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ),
  products: z.array(ProductSchema),
  sources: z.array(
    z.object({
      id: z.string(),
      url: z.string().url(),
      sha256: z.string(),
      retrievedAt: z.string(),
      bytes: z.number(),
      category: z.string(),
    }),
  ),
});
export const BasketSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string().trim().min(1).max(80),
    cityId: z.string(),
    start: Month,
    end: Month,
    items: z
      .array(z.object({ productId: z.string(), quantity: PositiveDecimal, unit: Unit }))
      .max(50),
  })
  .strict();
export type Product = z.infer<typeof ProductSchema>;
export type Observation = z.infer<typeof ObservationSchema>;
export type CityData = z.infer<typeof CityDataSchema>;
export type Release = z.infer<typeof ReleaseSchema>;
export type Basket = z.infer<typeof BasketSchema>;
export type Locale = 'en' | 'ja';

export function validateBasket(input: unknown, release: Release): Basket {
  const basket = BasketSchema.parse(input);
  if (
    !release.cities.some((c) => c.id === basket.cityId) ||
    basket.start > basket.end ||
    basket.start < release.start ||
    basket.end > release.end
  )
    throw new Error('invalidBasket');
  const ids = new Set<string>();
  for (const item of basket.items) {
    const product = release.products.find((p) => p.id === item.productId);
    if (!product || !product.units.includes(item.unit) || ids.has(item.productId))
      throw new Error('invalidBasket');
    ids.add(item.productId);
  }
  return basket;
}
