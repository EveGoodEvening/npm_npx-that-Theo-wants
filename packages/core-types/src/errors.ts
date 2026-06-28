import { z } from 'zod';

export const ErrorCodeSchema = z.enum([
  'PACKAGE_NOT_FOUND',
  'VERSION_NOT_FOUND',
  'TARBALL_INTEGRITY_FAILED',
  'POLICY_BLOCKED',
  'HUMAN_APPROVAL_REQUIRED',
  'AUDIT_REQUIRED',
  'SANDBOX_UNAVAILABLE',
  'RETRACTION_NOT_ELIGIBLE',
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'RATE_LIMITED',
  'PACKAGE_UNRESOLVED',
  'NO_SAFE_BIN',
  'INVALID_SPEC',
  'INVALID_CONFIG',
  'INTERNAL_ERROR',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const SafeNpmErrorSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).default({}),
  remediation: z.string().optional(),
});
export type SafeNpmErrorData = z.infer<typeof SafeNpmErrorSchema>;

/** Base error class carrying a structured code + remediation hint. */
export class SafeNpmError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;
  readonly remediation?: string;

  constructor(data: SafeNpmErrorData) {
    super(data.message);
    this.name = 'SafeNpmError';
    this.code = data.code;
    this.details = data.details ?? {};
    this.remediation = data.remediation;
  }

  toJSON(): SafeNpmErrorData {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      remediation: this.remediation,
    };
  }
}

/** HTTP status code mapping for each error code. */
export function toHttpStatus(code: ErrorCode): number {
  switch (code) {
    case 'PACKAGE_NOT_FOUND':
    case 'VERSION_NOT_FOUND':
      return 404;
    case 'TARBALL_INTEGRITY_FAILED':
      return 422;
    case 'POLICY_BLOCKED':
      return 403;
    case 'HUMAN_APPROVAL_REQUIRED':
      return 202;
    case 'AUDIT_REQUIRED':
      return 422;
    case 'SANDBOX_UNAVAILABLE':
      return 503;
    case 'RETRACTION_NOT_ELIGIBLE':
      return 409;
    case 'AUTH_REQUIRED':
      return 401;
    case 'FORBIDDEN':
      return 403;
    case 'RATE_LIMITED':
      return 429;
    case 'PACKAGE_UNRESOLVED':
      return 404;
    case 'NO_SAFE_BIN':
      return 422;
    case 'INVALID_SPEC':
    case 'INVALID_CONFIG':
      return 400;
    case 'INTERNAL_ERROR':
    default:
      return 500;
  }
}

/**
 * CLI exit code mapping per design §6.2.
 * 0 success; 10 approval required; 11 blocked; 12 audit data missing;
 * 13 unresolved; 14 no safe bin; 15 sandbox unavailable; other -> 1.
 */
export function toCliExitCode(code: ErrorCode): number {
  switch (code) {
    case 'HUMAN_APPROVAL_REQUIRED':
      return 10;
    case 'POLICY_BLOCKED':
    case 'FORBIDDEN':
    case 'RETRACTION_NOT_ELIGIBLE':
      return 11;
    case 'AUDIT_REQUIRED':
      return 12;
    case 'PACKAGE_NOT_FOUND':
    case 'VERSION_NOT_FOUND':
    case 'PACKAGE_UNRESOLVED':
      return 13;
    case 'NO_SAFE_BIN':
      return 14;
    case 'SANDBOX_UNAVAILABLE':
      return 15;
    case 'RATE_LIMITED':
      return 1;
    case 'AUTH_REQUIRED':
      return 1;
    case 'TARBALL_INTEGRITY_FAILED':
      return 11;
    case 'INVALID_SPEC':
    case 'INVALID_CONFIG':
      return 1;
    case 'INTERNAL_ERROR':
    default:
      return 1;
  }
}
