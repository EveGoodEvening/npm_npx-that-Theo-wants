import { z } from 'zod';
import { PackageName, PackageVersion, PublishId } from './package.js';

/**
 * Threshold retraction / unpublish record (design 8.4).
 */

export const RetractionMode = z.enum(['threshold_retract', 'admin_quarantine', 'policy_yank']);
export type RetractionMode = z.infer<typeof RetractionMode>;

export const RetractionRecord = z.object({
  id: z.string().uuid(),
  package: PackageName,
  version: PackageVersion,
  publishId: PublishId,
  actorUserId: z.string().uuid(),
  reason: z.string().min(1),
  mode: RetractionMode,
  observedInstallsAtRetract: z.number().int().nonnegative(),
  ageSecondsAtRetract: z.number().int().nonnegative(),
  /** Whether the semver tuple may be reused by a new publish_id. */
  semverReuseAllowed: z.boolean(),
  createdAt: z.string().datetime(),
});
export type RetractionRecord = z.infer<typeof RetractionRecord>;

/** Threshold rule from design 8.4: installs < 100 OR age < 5h. */
export const RETRACTION_INSTALL_THRESHOLD = 100;
export const RETRACTION_AGE_THRESHOLD_SECONDS = 5 * 60 * 60;

export function isRetractionEligible(
  observedInstalls: number,
  ageSeconds: number,
  installThreshold: number = RETRACTION_INSTALL_THRESHOLD,
  ageThresholdSeconds: number = RETRACTION_AGE_THRESHOLD_SECONDS,
): boolean {
  return observedInstalls < installThreshold || ageSeconds < ageThresholdSeconds;
}
