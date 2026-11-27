import { z } from 'zod';

/**
 * Checklist definition schema v1 (ADR-018). Definitions are JSONB, validated
 * at the API boundary, and IMMUTABLE once a version is created — work orders
 * snapshot the exact template_version_id they were assigned (Tech Spec §12.3).
 */
export const ChecklistItemSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9_]{2,60}$/, 'item key must be lower_snake_case'),
    label: z.string().min(2).max(200),
    type: z.enum(['check', 'measurement', 'informational']),
    required: z.boolean(),
    instructions: z.string().max(1000).optional(),
    unit: z.string().max(20).optional(),
    minValue: z.number().finite().optional(),
    maxValue: z.number().finite().optional(),
  })
  .strict()
  .refine((i) => (i.type === 'measurement' ? Boolean(i.unit) : true), {
    message: 'measurement items must declare a unit',
  });

export const ChecklistDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    items: z.array(ChecklistItemSchema).min(1).max(100),
  })
  .strict()
  .refine((def) => new Set(def.items.map((i) => i.key)).size === def.items.length, {
    message: 'item keys must be unique within a definition',
  });

export type ChecklistDefinitionInput = z.infer<typeof ChecklistDefinitionSchema>;
