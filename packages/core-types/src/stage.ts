import { z } from 'zod';
import { PackageName, PackageVersion, PublishId } from './package.js';

/**
 * Staged public release record (design 8.3 / 15).
 */

export const StageStatus = z.enum([
  'pending',
  'approved',
  'rejected',
  'cancelled',
]);
export type StageStatus = z.infer<typeof StageStatus>;

export const StageRecord = z.object({
  id: z.string().uuid(),
  package: PackageName,
  version: PackageVersion,
  publishId: PublishId,
  createdBy: z.string().uuid(),
  status: StageStatus,
  createdAt: z.string().datetime(),
  approvedBy: z.string().uuid().optional(),
  approvedAt: z.string().datetime().optional(),
  rejectedBy: z.string().uuid().optional(),
  rejectedAt: z.string().datetime().optional(),
  reviewNotes: z.string().optional(),
  /** Whether required checks passed before approval. */
  policyPassed: z.boolean().optional(),
  /** Recorded waiver reason if policy did not pass. */
  waiver: z.string().optional(),
});
export type StageRecord = z.infer<typeof StageRecord>;
