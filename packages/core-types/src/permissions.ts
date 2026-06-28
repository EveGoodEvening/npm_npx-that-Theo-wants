import { z } from 'zod';

/**
 * Permission report model (design 9.5 / 9.6).
 */

export const PermissionScope = z.enum([
  'fs',
  'net',
  'env',
  'childProcess',
  'workerThreads',
  'ffi',
  'native',
  'installScripts',
]);
export type PermissionScope = z.infer<typeof PermissionScope>;

export const FsPermission = z.object({
  read: z.array(z.string()).default([]),
  write: z.array(z.string()).default([]),
});
export type FsPermission = z.infer<typeof FsPermission>;

export const DeclaredPermissions = z.object({
  fs: FsPermission.optional(),
  net: z.array(z.string()).default([]),
  env: z.array(z.string()).default([]),
  childProcess: z.boolean().default(false),
  workerThreads: z.boolean().default(false),
  ffi: z.boolean().default(false),
  native: z.boolean().default(false),
  installScripts: z.boolean().default(false),
});
export type DeclaredPermissions = z.infer<typeof DeclaredPermissions>;

export const PermissionEnforcement = z.object({
  mode: z.enum(['node-permission', 'os-sandbox', 'disclosure-only']).default('disclosure-only'),
  available: z.boolean().default(false),
  limitations: z.array(z.string()).default([]),
  command: z.array(z.string()).default([]),
});
export type PermissionEnforcement = z.infer<typeof PermissionEnforcement>;

export const PermissionReport = z.object({
  declared: DeclaredPermissions.default({}),
  inferred: DeclaredPermissions.default({}),
  /** Mismatches between declared and inferred, e.g. network used but not declared. */
  mismatches: z
    .array(
      z.object({
        scope: PermissionScope,
        message: z.string(),
      }),
    )
    .default([]),
  enforceable: z.boolean().default(false),
  enforcement: PermissionEnforcement.optional(),
});
export type PermissionReport = z.infer<typeof PermissionReport>;
