import { z } from 'zod';

/**
 * Versioned asset-family specification schema (Tech Spec §11.4): JSONB is
 * validated at the API boundary against a versioned schema. LT panel + HT
 * switchgear fields per the first vertical wedge; promoting any field to a
 * relational column happens only with usage evidence.
 */
export const AssetSpecificationSchema = z
  .object({
    schemaVersion: z.literal(1),
    electrical: z
      .object({
        ratedVoltageV: z.number().positive().max(110_000).optional(),
        voltageClassKv: z.number().positive().max(800).optional(),
        phaseCount: z.union([z.literal(1), z.literal(3)]).optional(),
        ratedFrequencyHz: z.union([z.literal(50), z.literal(60)]).optional(),
        ratedCurrentA: z.number().positive().max(6300).optional(),
        shortCircuitWithstandKa: z.number().positive().max(80).optional(),
        breakingCapacityKa: z.number().positive().max(80).optional(),
        insulationMedium: z.enum(['air', 'sf6', 'vacuum', 'oil', 'solid']).optional(),
      })
      .optional(),
    construction: z
      .object({
        ipRating: z.string().regex(/^IP[0-9]{2}$/, 'IP rating must look like IP54').optional(),
        busbarMaterial: z.enum(['copper', 'aluminium']).optional(),
        incomerType: z.enum(['ACB', 'VCB', 'MCCB', 'SF6', 'RMU']).optional(),
        outgoingFeederCount: z.number().int().positive().max(200).optional(),
        enclosureForm: z.string().max(40).optional(),
      })
      .optional(),
    documentation: z
      .object({
        drawingRevision: z.string().max(40).optional(),
      })
      .optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

export type AssetSpecificationInput = z.infer<typeof AssetSpecificationSchema>;
